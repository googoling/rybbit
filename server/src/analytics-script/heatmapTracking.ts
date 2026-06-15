import { ScriptConfig, HeatmapEvent, HeatmapBatch } from "./types.js";
import { Tracker } from "./tracking.js";
import { debounce } from "./utils.js";

const SAMPLE_STORAGE_KEY = "rybbit-heatmap-sampled";
const BATCH_SIZE = 30;
const BATCH_INTERVAL = 5000;
const SELECTOR_MAX_DEPTH = 5;
const ELEMENT_TEXT_MAX_LENGTH = 100;
const MAX_EVENTS_PER_BATCH = 200;

// Rage clicks: repeated clicks in a tight spot within a short window.
const RAGE_RADIUS_PX = 30;
const RAGE_WINDOW_MS = 1500;
const RAGE_THRESHOLD = 3;
// Dead clicks: a click on a non-interactive element that triggers no DOM change.
const DEAD_CHECK_MS = 700;
const INTERACTIVE_ANCESTOR_DEPTH = 4;
const INTERACTIVE_TAGS = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "LABEL", "SUMMARY", "OPTION"]);
const INTERACTIVE_ROLES = new Set(["button", "link", "tab", "menuitem", "checkbox", "radio", "switch", "option"]);
// Attention map: timer-sampled cursor positions (dwell-weighted proxy for where users look).
const MOVE_SAMPLE_MS = 100;
const MOVE_MIN_DELTA_PX = 4;
const MAX_MOVE_SAMPLES = 600;

interface RecentClick {
  x: number;
  y: number;
  t: number;
}

// Positional fields shared by a click and any rage/dead marker emitted for it.
type HeatmapMarkerContext = Omit<HeatmapEvent, "type" | "timestamp">;

// Walk up a few ancestors to decide whether a click landed on something meant to react.
function isInteractive(element: HTMLElement | null): boolean {
  let current: HTMLElement | null = element;
  let depth = 0;
  while (current && depth < INTERACTIVE_ANCESTOR_DEPTH) {
    if (INTERACTIVE_TAGS.has(current.tagName)) return true;
    const role = current.getAttribute("role");
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    if (current.hasAttribute("onclick")) return true;
    if (current.isContentEditable) return true;
    const tabindex = current.getAttribute("tabindex");
    if (tabindex !== null && tabindex !== "-1") return true;
    current = current.parentElement;
    depth++;
  }
  return false;
}

/**
 * Determines if this session should be captured based on sample rate.
 * Persists the decision in sessionStorage so every page in the session agrees.
 */
function shouldSampleSession(sampleRate: number): boolean {
  if (sampleRate >= 100) return true;
  if (sampleRate <= 0) return false;

  try {
    const existingDecision = sessionStorage.getItem(SAMPLE_STORAGE_KEY);
    if (existingDecision !== null) {
      return existingDecision === "1";
    }

    const sampled = Math.random() * 100 < sampleRate;
    sessionStorage.setItem(SAMPLE_STORAGE_KEY, sampled ? "1" : "0");

    return sampled;
  } catch {
    return Math.random() * 100 < sampleRate;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class HeatmapTrackingManager {
  private tracker: Tracker;
  private config: ScriptConfig;
  private active = false;
  private eventBuffer: HeatmapEvent[] = [];
  private batchTimer?: number;
  private maxScrollDepth = 0;
  private recentClicks: RecentClick[] = [];
  private rageCooldownUntil = 0;
  private lastMutationAt = 0;
  private mutationObserver?: MutationObserver;
  private lastMoveX = 0;
  private lastMoveY = 0;
  private lastMoveAt = 0;
  private lastMoveEmitAt = 0;
  private lastEmitX = -9999;
  private lastEmitY = -9999;
  private moveSampleCount = 0;
  private moveTimer?: number;
  private dimsObserver?: ResizeObserver;
  private cachedPageWidth = 0;
  private cachedPageHeight = 0;
  private boundHandleClick: (event: MouseEvent) => void;
  private boundHandleScroll: () => void;
  private boundHandleMouseMove: (event: MouseEvent) => void;
  private boundRefreshPageDims: () => void;
  private boundHandleVisibilityChange: () => void;
  private boundFlush: () => void;

  constructor(tracker: Tracker, config: ScriptConfig) {
    this.tracker = tracker;
    this.config = config;
    this.boundHandleClick = this.handleClick.bind(this);
    // Scroll is high-frequency; only the running max matters, so debounce hard.
    this.boundHandleScroll = debounce(this.handleScroll.bind(this), this.config.debounceDuration || 500);
    this.boundHandleMouseMove = this.handleMouseMove.bind(this);
    this.boundRefreshPageDims = this.refreshPageDims.bind(this);
    this.boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.boundFlush = this.flushOnExit.bind(this);
  }

  initialize(): void {
    if (!this.config.enableHeatmaps) {
      return;
    }
    // Guard against double-init (e.g. SPA re-init) registering duplicate listeners/timers.
    if (this.active) {
      return;
    }

    const sampleRate = this.config.heatmapSampleRate;
    if (sampleRate !== undefined && !shouldSampleSession(sampleRate)) {
      return;
    }

    this.active = true;

    document.addEventListener("click", this.boundHandleClick, true);
    window.addEventListener("scroll", this.boundHandleScroll, { passive: true });
    document.addEventListener("visibilitychange", this.boundHandleVisibilityChange);
    window.addEventListener("pagehide", this.boundFlush);

    // Attention (mouse-movement) capture: cache page dims once, track the cursor
    // cheaply, then sample it on a timer so dwell time is naturally weighted.
    this.refreshPageDims();
    window.addEventListener("mousemove", this.boundHandleMouseMove, { passive: true });
    window.addEventListener("resize", this.boundRefreshPageDims, { passive: true });
    // Content-driven size changes (SPA route changes, lazy-loaded content) don't fire a
    // window resize, so observe the document too to keep cached page dims accurate.
    if (typeof ResizeObserver !== "undefined") {
      this.dimsObserver = new ResizeObserver(this.boundRefreshPageDims);
      this.dimsObserver.observe(document.documentElement);
    }
    this.moveTimer = window.setInterval(() => this.sampleMove(), MOVE_SAMPLE_MS);

    // A lightweight global mutation signal powers dead-click detection: if the DOM
    // never changes after a click on a non-interactive element, the click was "dead".
    if (typeof MutationObserver !== "undefined") {
      this.mutationObserver = new MutationObserver(() => {
        this.lastMutationAt = Date.now();
      });
      this.mutationObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }

    this.setupBatchTimer();
  }

  private getPathname(): string {
    const url = new URL(window.location.href);
    if (url.hash && url.hash.startsWith("#/")) {
      return url.hash.substring(1);
    }
    return url.pathname;
  }

  private handleClick(event: MouseEvent): void {
    if (!this.active) return;

    const pageWidth = document.documentElement.scrollWidth;
    const pageHeight = document.documentElement.scrollHeight;
    if (pageWidth <= 0 || pageHeight <= 0) return;

    const xPercent = clamp((event.pageX / pageWidth) * 100, 0, 100);
    const scrollDepth = clamp(((window.scrollY + window.innerHeight) / pageHeight) * 100, 0, 100);
    if (scrollDepth > this.maxScrollDepth) {
      this.maxScrollDepth = scrollDepth;
    }

    const target = event.target as HTMLElement | null;
    const now = Date.now();

    // Shared positional context reused by the click + any rage/dead markers.
    const context = {
      pathname: this.getPathname(),
      x_percent: xPercent,
      y_absolute: Math.round(event.pageY),
      viewport_width: Math.round(window.innerWidth),
      viewport_height: Math.round(window.innerHeight),
      page_width: Math.round(pageWidth),
      page_height: Math.round(pageHeight),
      scroll_depth: Math.round(scrollDepth),
      element_selector: target ? this.buildSelector(target) : "",
      element_text: target ? this.getElementText(target) : "",
    };

    this.addEvent({ type: "click", ...context, timestamp: now });

    this.detectRageClick(event, context, now);
    this.detectDeadClick(target, context, now);
  }

  // Emit one "rage" marker per burst of rapid clicks landing in the same spot.
  private detectRageClick(event: MouseEvent, context: HeatmapMarkerContext, now: number): void {
    this.recentClicks = this.recentClicks.filter(c => now - c.t <= RAGE_WINDOW_MS);
    this.recentClicks.push({ x: event.pageX, y: event.pageY, t: now });

    const nearby = this.recentClicks.filter(
      c => Math.abs(c.x - event.pageX) <= RAGE_RADIUS_PX && Math.abs(c.y - event.pageY) <= RAGE_RADIUS_PX
    );

    if (nearby.length >= RAGE_THRESHOLD && now >= this.rageCooldownUntil) {
      this.rageCooldownUntil = now + RAGE_WINDOW_MS;
      this.addEvent({ type: "rage", ...context, timestamp: now });
    }
  }

  // Emit a "dead" marker if a click on a non-interactive element produced no DOM change.
  private detectDeadClick(target: HTMLElement | null, context: HeatmapMarkerContext, clickedAt: number): void {
    if (isInteractive(target)) return;

    window.setTimeout(() => {
      if (!this.active) return;
      // Navigation or any DOM mutation after the click means it did something.
      if (this.lastMutationAt > clickedAt) return;
      if (document.visibilityState !== "visible") return;
      this.addEvent({ type: "dead", ...context, timestamp: clickedAt });
    }, DEAD_CHECK_MS);
  }

  private handleScroll(): void {
    if (!this.active) return;

    const pageHeight = document.documentElement.scrollHeight;
    if (pageHeight <= 0) return;

    const scrollDepth = clamp(((window.scrollY + window.innerHeight) / pageHeight) * 100, 0, 100);
    if (scrollDepth > this.maxScrollDepth) {
      this.maxScrollDepth = scrollDepth;
    }
  }

  // Cheap pointer tracking: just record the latest position; the timer does the work.
  private handleMouseMove(event: MouseEvent): void {
    if (!this.active) return;
    this.lastMoveX = event.pageX;
    this.lastMoveY = event.pageY;
    this.lastMoveAt = Date.now();
  }

  // Cache page dimensions so the high-frequency move sampler never forces a reflow.
  private refreshPageDims(): void {
    this.cachedPageWidth = document.documentElement.scrollWidth;
    this.cachedPageHeight = document.documentElement.scrollHeight;
  }

  // Emit at most one cursor sample per tick, and only when the pointer actually
  // moved since the last sample — throttles mousemove to ~10/s and skips parked
  // cursors, while lingering produces repeated nearby samples (dwell weighting).
  private sampleMove(): void {
    if (!this.active || this.moveSampleCount >= MAX_MOVE_SAMPLES) return;
    if (document.visibilityState !== "visible") return;
    if (this.lastMoveAt <= this.lastMoveEmitAt) return;
    if (
      Math.abs(this.lastMoveX - this.lastEmitX) < MOVE_MIN_DELTA_PX &&
      Math.abs(this.lastMoveY - this.lastEmitY) < MOVE_MIN_DELTA_PX
    ) {
      return;
    }

    const pageWidth = this.cachedPageWidth || document.documentElement.scrollWidth;
    const pageHeight = this.cachedPageHeight || document.documentElement.scrollHeight;
    if (pageWidth <= 0 || pageHeight <= 0) return;

    const now = Date.now();
    this.lastMoveEmitAt = now;
    this.lastEmitX = this.lastMoveX;
    this.lastEmitY = this.lastMoveY;
    this.moveSampleCount++;

    const scrollDepth = clamp(((window.scrollY + window.innerHeight) / pageHeight) * 100, 0, 100);

    this.addEvent({
      type: "move",
      pathname: this.getPathname(),
      x_percent: clamp((this.lastMoveX / pageWidth) * 100, 0, 100),
      y_absolute: Math.round(this.lastMoveY),
      viewport_width: Math.round(window.innerWidth),
      viewport_height: Math.round(window.innerHeight),
      page_width: Math.round(pageWidth),
      page_height: Math.round(pageHeight),
      scroll_depth: Math.round(scrollDepth),
      element_selector: "",
      element_text: "",
      timestamp: now,
    });
  }

  // Build a stable-ish CSS selector by walking ancestors up to body.
  private buildSelector(element: HTMLElement): string {
    const parts: string[] = [];
    let current: HTMLElement | null = element;
    let depth = 0;

    while (current && current !== document.body && depth < SELECTOR_MAX_DEPTH) {
      const tag = current.tagName.toLowerCase();
      if (current.id) {
        parts.unshift(`${tag}#${current.id}`);
        break;
      }

      const parent: HTMLElement | null = current.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(child => child.tagName === current!.tagName);
        if (sameTag.length > 1) {
          const index = sameTag.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-of-type(${index})`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }

      current = parent;
      depth++;
    }

    return parts.join(" > ").slice(0, 1024);
  }

  private getElementText(element: HTMLElement): string {
    return element.textContent?.trim().substring(0, ELEMENT_TEXT_MAX_LENGTH) || "";
  }

  private addEvent(event: HeatmapEvent): void {
    this.eventBuffer.push(event);

    if (this.eventBuffer.length >= BATCH_SIZE) {
      this.flushEvents();
    }
  }

  private emitScrollEvent(): void {
    if (this.maxScrollDepth <= 0) return;

    const pageWidth = document.documentElement.scrollWidth;
    const pageHeight = document.documentElement.scrollHeight;

    this.eventBuffer.push({
      type: "scroll",
      pathname: this.getPathname(),
      x_percent: 0,
      y_absolute: 0,
      viewport_width: Math.round(window.innerWidth),
      viewport_height: Math.round(window.innerHeight),
      page_width: Math.round(pageWidth),
      page_height: Math.round(pageHeight),
      scroll_depth: Math.round(this.maxScrollDepth),
      timestamp: Date.now(),
    });

    this.maxScrollDepth = 0;
  }

  private setupBatchTimer(): void {
    this.clearBatchTimer();
    this.batchTimer = window.setInterval(() => {
      if (this.eventBuffer.length > 0) {
        this.flushEvents();
      }
    }, BATCH_INTERVAL);
  }

  private clearBatchTimer(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
      this.batchTimer = undefined;
    }
  }

  private buildBatch(events: HeatmapEvent[]): HeatmapBatch {
    return {
      userId: this.tracker.getUserId() || "",
      events,
      metadata: {
        hostname: window.location.hostname,
        language: navigator.language,
      },
    };
  }

  private flushEvents(): void {
    while (this.eventBuffer.length > 0) {
      const events = this.eventBuffer.splice(0, MAX_EVENTS_PER_BATCH);
      this.sendBatch(this.buildBatch(events), false);
    }
  }

  // Emit the running scroll depth then drain the buffer; called on page exit.
  private flushOnExit(): void {
    if (!this.active) return;

    this.emitScrollEvent();
    while (this.eventBuffer.length > 0) {
      const events = this.eventBuffer.splice(0, MAX_EVENTS_PER_BATCH);
      this.sendBatch(this.buildBatch(events), true);
    }
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      this.flushOnExit();
    }
  }

  private sendBatch(batch: HeatmapBatch, keepalive: boolean): void {
    try {
      fetch(`${this.config.analyticsHost}/heatmap/record/${this.config.siteId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
        mode: "cors",
        keepalive,
      }).catch(() => {});
    } catch {
      // Sending heatmap data must never disrupt the page.
    }
  }

  cleanup(): void {
    if (!this.active) return;

    document.removeEventListener("click", this.boundHandleClick, true);
    window.removeEventListener("scroll", this.boundHandleScroll);
    window.removeEventListener("mousemove", this.boundHandleMouseMove);
    window.removeEventListener("resize", this.boundRefreshPageDims);
    document.removeEventListener("visibilitychange", this.boundHandleVisibilityChange);
    window.removeEventListener("pagehide", this.boundFlush);

    this.mutationObserver?.disconnect();
    this.mutationObserver = undefined;
    this.recentClicks = [];

    if (this.moveTimer) {
      clearInterval(this.moveTimer);
      this.moveTimer = undefined;
    }

    this.dimsObserver?.disconnect();
    this.dimsObserver = undefined;

    this.clearBatchTimer();
    this.flushOnExit();
    this.active = false;
  }
}
