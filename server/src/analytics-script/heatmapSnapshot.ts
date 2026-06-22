import { ScriptConfig, SessionReplayEvent } from "./types.js";

// Captures ONE frozen DOM snapshot (rrweb Meta + FullSnapshot) for the heatmap backdrop.
// Not a session replay — a single static page render, deduplicated per path. Reuses the
// same lazily-loaded rrweb (replay.js) the session-replay recorder uses, so it adds no
// weight to the base tracking bundle.

const SAMPLE_STORAGE_KEY = "rybbit-heatmap-sampled";
const LOCAL_TS_PREFIX = "rybbit-hm-snap-ts-v3:"; // last SUCCESSFUL capture time per path (cross-session)
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-snapshot a given path at most weekly
const CAPTURE_DELAY_MS = 4500; // let the page (incl. lazy/cached CSS like FlyingPress) settle first
const MAX_PAYLOAD_BYTES = 8_000_000; // skip truly pathological pages rather than ship a huge blob
const STOP_TIMEOUT_MS = 8000; // never leave the recorder running
const RRWEB_FULL_SNAPSHOT = 2;
const MIN_SNAPSHOT_WIDTH = 1600; // only store backdrops from wide viewports; heatmap events are still tracked at all sizes

export class HeatmapSnapshotManager {
  private config: ScriptConfig;
  private active = false;
  private stopRecordingFn?: () => void;
  private sent = false;
  private attempted = new Set<string>(); // paths attempted this page-load (in-memory)

  constructor(config: ScriptConfig) {
    this.config = config;
  }

  initialize(): void {
    if (!this.config.enableHeatmaps) return;
    // Align with the heatmap event sampler: only snapshot sessions we're also heat-mapping.
    try {
      if (sessionStorage.getItem(SAMPLE_STORAGE_KEY) === "0") return;
    } catch {
      // sessionStorage unavailable — fall through and let capture proceed.
    }
    this.active = true;
    this.diag("init");
    this.scheduleCapture();
  }

  // Lightweight diagnostic beacon so capture failures are visible in the server logs.
  // Body stays tiny, so keepalive is safe here.
  private diag(stage: string): void {
    try {
      fetch(`${this.config.analyticsHost}/heatmap/snapshot/${this.config.siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ diag: stage, pathname: this.getPathname() }),
        mode: "cors",
        keepalive: true,
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  private getPathname(): string {
    const url = new URL(window.location.href);
    if (url.hash && url.hash.startsWith("#/")) {
      return url.hash.substring(1);
    }
    return url.pathname;
  }

  private alreadyCaptured(path: string): boolean {
    if (this.attempted.has(path)) return true;
    try {
      const ts = localStorage.getItem(LOCAL_TS_PREFIX + path);
      if (ts && Date.now() - Number(ts) < SNAPSHOT_TTL_MS) return true;
    } catch {
      // storage unavailable — allow capture
    }
    return false;
  }

  // Persist ONLY on success; a failed attempt leaves no marker so the next page load retries.
  private markPersisted(path: string): void {
    try {
      localStorage.setItem(LOCAL_TS_PREFIX + path, String(Date.now()));
    } catch {
      // ignore
    }
  }

  private scheduleCapture(): void {
    const run = () => window.setTimeout(() => this.capture(), CAPTURE_DELAY_MS);
    if (document.readyState === "complete") {
      run();
    } else {
      window.addEventListener("load", run, { once: true });
    }
  }

  private async capture(): Promise<void> {
    if (!this.active) return;
    // Only store backdrops from wide viewports so the heatmap renders on a large,
    // representative page render. Narrow windows/mobile still track events; they just
    // don't contribute a (low-res) backdrop.
    if (window.innerWidth < MIN_SNAPSHOT_WIDTH) {
      this.diag("viewport-too-narrow:" + window.innerWidth);
      return;
    }
    const path = this.getPathname();
    if (this.alreadyCaptured(path)) return;
    this.attempted.add(path); // prevent duplicate attempts within this page-load only
    this.diag("capture");

    try {
      await this.loadRrweb();
    } catch {
      this.diag("rrweb-load-fail");
      return;
    }
    this.takeSnapshot(path);
  }

  private loadRrweb(): Promise<void> {
    if ((window as any).rrweb?.record) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `${this.config.analyticsHost}/replay.js`;
      script.async = false;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load rrweb"));
      document.head.appendChild(script);
    });
  }

  private takeSnapshot(path: string): void {
    const rrweb = (window as any).rrweb;
    if (!rrweb?.record) {
      this.diag("no-rrweb-record");
      return;
    }

    const events: SessionReplayEvent[] = [];

    const finish = () => {
      if (this.stopRecordingFn) {
        try {
          this.stopRecordingFn();
        } catch {
          // ignore
        }
        this.stopRecordingFn = undefined;
      }
      if (this.sent) return;
      if (events.some(e => e.type === RRWEB_FULL_SNAPSHOT)) {
        this.sent = true;
        this.send(path, events);
      } else {
        this.diag("no-fullsnapshot");
      }
    };

    try {
      this.stopRecordingFn = rrweb.record({
        emit: (event: any) => {
          events.push({ type: event.type, data: event.data, timestamp: event.timestamp || Date.now() });
          // Meta (4) then FullSnapshot (2) are emitted first; once we have the full
          // snapshot we have everything the backdrop needs — stop and send.
          if (event.type === RRWEB_FULL_SNAPSHOT) {
            window.setTimeout(finish, 0);
          }
        },
        recordCanvas: false,
        collectFonts: false,
        inlineImages: false,
        // Privacy: mask inputs by default; honor the site's replay block/ignore/mask classes.
        maskAllInputs: this.config.sessionReplayMaskAllInputs ?? true,
        maskInputOptions: this.config.sessionReplayMaskInputOptions ?? { password: true, email: true },
        blockClass: this.config.sessionReplayBlockClass ?? "rr-block",
        blockSelector: this.config.sessionReplayBlockSelector ?? null,
        ignoreClass: this.config.sessionReplayIgnoreClass ?? "rr-ignore",
        maskTextClass: this.config.sessionReplayMaskTextClass ?? "rr-mask",
        // A static backdrop needs no interactions; drop scripts/comments to shrink the blob.
        sampling: { mousemove: false, scroll: 0, input: "last" },
        slimDOMOptions: { script: true, comment: true, headWhitespace: true },
      });
    } catch {
      this.diag("record-threw");
      return;
    }

    // Safety net: never leave the recorder attached if no full snapshot arrived.
    window.setTimeout(finish, STOP_TIMEOUT_MS);
  }

  private send(path: string, events: SessionReplayEvent[]): void {
    let body: string;
    try {
      body = JSON.stringify({
        pathname: path,
        hostname: window.location.hostname,
        page_width: Math.round(document.documentElement.scrollWidth),
        page_height: Math.round(document.documentElement.scrollHeight),
        viewport_width: Math.round(window.innerWidth),
        viewport_height: Math.round(window.innerHeight),
        events,
      });
    } catch {
      this.diag("stringify-fail");
      return;
    }
    if (body.length > MAX_PAYLOAD_BYTES) {
      this.diag("client-too-large:" + body.length);
      return;
    }

    // NOTE: no keepalive — the Fetch spec caps keepalive bodies at 64KB, and a snapshot is
    // far larger. This is a normal fetch fired ~2.5s after load, so keepalive isn't needed.
    try {
      fetch(`${this.config.analyticsHost}/heatmap/snapshot/${this.config.siteId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        mode: "cors",
      })
        .then(res => {
          if (res.ok) this.markPersisted(path);
          else this.diag("send-status-" + res.status);
        })
        .catch(() => this.diag("send-fetch-fail"));
    } catch {
      // Snapshot capture must never disrupt the page.
    }
  }

  cleanup(): void {
    this.active = false;
    if (this.stopRecordingFn) {
      try {
        this.stopRecordingFn();
      } catch {
        // ignore
      }
      this.stopRecordingFn = undefined;
    }
  }
}
