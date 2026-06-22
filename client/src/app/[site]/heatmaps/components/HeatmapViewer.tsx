"use client";

import { useExtracted } from "next-intl";
import { MousePointerClick } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HeatmapPoint, HeatmapSegment, ScrollMapBucket } from "@/api/analytics/endpoints/heatmap";
import {
  useGetAttentionMap,
  useGetClickHeatmap,
  useGetClickInsights,
  useGetHeatmapSnapshot,
  useGetRankedElements,
  useGetScrollMap,
} from "@/api/analytics/hooks/heatmap/useHeatmap";
import { drawDiffHeatmap, drawHeatmap, HeatPoint } from "@/lib/heatmap/renderHeatmap";
import { AttentionDataTable } from "./AttentionDataTable";
import { HeatmapBackdrop } from "./HeatmapBackdrop";
import { HeatmapElementList } from "./HeatmapElementList";
import { HeatmapLegend } from "./HeatmapLegend";
import { ScrollDataTable } from "./ScrollDataTable";
import { useHeatmapStore } from "./heatmapStore";

function interpolateReach(buckets: ScrollMapBucket[], depthPct: number): number {
  if (!buckets.length) return 0;
  let prev = buckets[0];
  for (const b of buckets) {
    if (b.depth >= depthPct) {
      if (b.depth === prev.depth) return b.reach;
      const t = (depthPct - prev.depth) / (b.depth - prev.depth);
      return prev.reach + (b.reach - prev.reach) * t;
    }
    prev = b;
  }
  return buckets[buckets.length - 1].reach;
}

function drawScrollMap(
  ctx: CanvasRenderingContext2D,
  buckets: ScrollMapBucket[],
  foldPercent: number,
  width: number,
  height: number
) {
  ctx.clearRect(0, 0, width, height);
  if (!buckets.length) return;
  for (let y = 0; y < height; y++) {
    const reach = interpolateReach(buckets, (y / height) * 100) / 100;
    const r = Math.round(255 * reach);
    const b = Math.round(255 * (1 - reach));
    ctx.fillStyle = `rgba(${r}, 70, ${b}, 0.35)`;
    ctx.fillRect(0, y, width, 1);
  }
  if (foldPercent > 0) {
    const foldY = Math.min(height - 1, (foldPercent / 100) * height);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, foldY);
    ctx.lineTo(width, foldY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawAreaMap(ctx: CanvasRenderingContext2D, points: HeatmapPoint[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  if (!points.length) return;

  const ZONES = 10;
  const bandH = height / ZONES;
  const clicksByBand = Array.from({ length: ZONES }, (_, i) => {
    const lo = i * bandH;
    const hi = (i + 1) * bandH;
    return points.filter(p => p.y_absolute >= lo && p.y_absolute < hi).reduce((s, p) => s + p.count, 0);
  });
  const maxClicks = Math.max(...clicksByBand, 1);
  const totalClicks = clicksByBand.reduce((s, c) => s + c, 0) || 1;

  for (let i = 0; i < ZONES; i++) {
    const ratio = clicksByBand[i] / maxClicks;
    const r = Math.round(220 * ratio + 30 * (1 - ratio));
    const g = Math.round(80 * ratio + 70 * (1 - ratio));
    const b = Math.round(20 * ratio + 200 * (1 - ratio));
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.1 + 0.4 * ratio})`;
    ctx.fillRect(0, i * bandH, width, bandH);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, i * bandH, width, bandH);

    const pct = ((clicksByBand[i] / totalClicks) * 100).toFixed(1);
    const fontSize = Math.max(12, Math.min(22, bandH * 0.28));
    ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(`${pct}%`, width / 2, i * bandH + bandH / 2);
  }
}

// Depth-based attention: full-width horizontal bands colored by how much attention
// each scroll-depth band received (Clarity-style dwell-by-depth). Robust at low n.
function drawAttentionBands(ctx: CanvasRenderingContext2D, points: HeatmapPoint[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  if (!points.length) return;
  const ZONES = 20;
  const bandH = height / ZONES;
  const samples = Array.from({ length: ZONES }, (_, i) => {
    const lo = i * bandH;
    const hi = (i + 1) * bandH;
    return points.filter(p => p.y_absolute >= lo && p.y_absolute < hi).reduce((s, p) => s + p.count, 0);
  });
  const max = Math.max(...samples, 1);
  for (let i = 0; i < ZONES; i++) {
    const ratio = samples[i] / max;
    const hue = Math.round(240 - 240 * ratio);
    ctx.fillStyle = `hsla(${hue}, 85%, 50%, ${0.15 + 0.4 * ratio})`;
    ctx.fillRect(0, i * bandH, width, bandH);
  }
}

function toHeatPoints(points: HeatmapPoint[], baseWidth: number): HeatPoint[] {
  return points.map(p => ({ x: (p.x_percent / 100) * baseWidth, y: p.y_absolute, value: p.count }));
}

function computeAreaBands(points: HeatmapPoint[], totalClicks: number, baseHeight: number) {
  const ZONES = 10;
  const bandH = baseHeight / ZONES;
  return Array.from({ length: ZONES }, (_, i) => {
    const lo = i * bandH;
    const hi = (i + 1) * bandH;
    const clicks = points.filter(p => p.y_absolute >= lo && p.y_absolute < hi).reduce((s, p) => s + p.count, 0);
    const pct = totalClicks > 0 ? Math.round((clicks / totalClicks) * 1000) / 10 : 0;
    return { index: i + 1, startPct: i * 10, endPct: (i + 1) * 10, clicks, pct };
  });
}

const ATTENTION_ZONES = 20;

export function HeatmapViewer() {
  const t = useExtracted();
  const { hostname, pathname, device, view, clicksMode, attentionMode, segment, goalId, selectedSnapshotAt, opacity } =
    useHeatmapStore();
  const deviceParam = device || undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const [attentionHover, setAttentionHover] = useState<{ zoneIdx: number; screenX: number; screenY: number } | null>(null);
  const [scrollHover, setScrollHover] = useState<{ screenY: number; reachPct: number } | null>(null);
  const [hoveredBadge, setHoveredBadge] = useState<{ idx: number; screenLeft: number; screenTop: number } | null>(null);
  const [backdropHeight, setBackdropHeight] = useState(0);
  const [hoveredRegion, setHoveredRegion] = useState<number | null>(null);
  const snapshotDocRef = useRef<Document | null>(null);
  const [docVersion, setDocVersion] = useState(0);

  const isDiff = view === "clicks" && segment === "diff";
  const baseSegment: HeatmapSegment = segment === "diff" ? "all" : segment;
  const hasPath = !!pathname;
  const showInsights = view === "clicks" && (clicksMode === "rage" || clicksMode === "dead");
  // Mode for the click/element queries. rage/dead go through the insights endpoint, so
  // they map to "all" here; the Area view always reflects all clicks.
  const clickMode =
    view === "area"
      ? "all"
      : clicksMode === "first" || clicksMode === "last" || clicksMode === "error"
        ? clicksMode
        : "all";

  const snapshot = useGetHeatmapSnapshot(hostname, pathname, deviceParam, hasPath, selectedSnapshotAt ?? undefined);

  const clicks = useGetClickHeatmap({
    hostname, pathname, device: deviceParam, goalId, segment: baseSegment, mode: clickMode,
    enabled: (view === "clicks" || view === "area") && !showInsights && hasPath,
  });
  const clicksConverters = useGetClickHeatmap({
    hostname, pathname, device: deviceParam, goalId, segment: "converters",
    enabled: isDiff && !!goalId && hasPath,
  });
  const elements = useGetRankedElements({
    hostname, pathname, device: deviceParam, goalId, segment: baseSegment, mode: clickMode,
    enabled: (view === "clicks" || view === "area") && !showInsights && hasPath,
  });
  const attention = useGetAttentionMap({
    hostname, pathname, device: deviceParam, goalId, segment: baseSegment,
    enabled: view === "attention" && hasPath,
  });
  const scroll = useGetScrollMap({
    hostname, pathname, device: deviceParam, goalId, segment: baseSegment,
    enabled: view === "scroll" && hasPath,
  });
  const insights = useGetClickInsights({
    hostname, pathname, device: deviceParam, goalId, segment: baseSegment,
    enabled: showInsights && hasPath,
  });

  const maxY = useMemo(() => {
    let m = 0;
    for (const arr of [clicks.data?.points, attention.data?.points, insights.data?.rage.points, insights.data?.dead.points]) {
      if (arr) for (const p of arr) if (p.y_absolute > m) m = p.y_absolute;
    }
    return m;
  }, [clicks.data, attention.data, insights.data]);

  const viewportWidth = useMemo(() => {
    const meta = (snapshot.data?.events ?? []).find((e: any) => e?.type === 4);
    return meta?.data?.width || 0;
  }, [snapshot.data]);

  const hasSnapshot = !!snapshot.data?.events?.length && snapshot.data.pageHeight > 0;
  const baseWidth = hasSnapshot
    ? viewportWidth || snapshot.data!.pageWidth || 1280
    : Math.max(clicks.data?.pageWidth || attention.data?.pageWidth || scroll.data?.pageWidth || 1280, 320);
  const dataMaxY = maxY > 0 ? maxY + 120 : 0;
  const baseHeight = hasSnapshot
    ? Math.max(snapshot.data!.pageHeight, dataMaxY, backdropHeight)
    : Math.max(clicks.data?.pageHeight || 0, attention.data?.pageHeight || 0, scroll.data?.pageHeight || 0, dataMaxY, 600);

  const activeInsightPoints = clicksMode === "rage" ? insights.data?.rage.points ?? [] : insights.data?.dead.points ?? [];

  const heatPoints = useMemo(() => {
    let points: HeatmapPoint[] = [];
    if (showInsights) points = activeInsightPoints;
    else if (view === "clicks" || view === "area") points = clicks.data?.points ?? [];
    else if (view === "attention") points = attention.data?.points ?? [];
    return toHeatPoints(points, baseWidth);
  }, [view, clicksMode, showInsights, clicks.data, attention.data, insights.data, baseWidth]);

  const diffPoints = useMemo(() => {
    if (!isDiff) return [];
    const all = clicks.data, conv = clicksConverters.data;
    if (!all || !conv) return [];
    const allTotal = all.totalClicks || 1, convTotal = conv.totalClicks || 1;
    const map = new Map<string, number>();
    for (const p of all.points) map.set(`${p.x_percent},${p.y_absolute}`, -(p.count / allTotal));
    for (const p of conv.points) {
      const key = `${p.x_percent},${p.y_absolute}`;
      map.set(key, (map.get(key) || 0) + p.count / convTotal);
    }
    return Array.from(map.entries()).map(([key, value]) => {
      const [xp, ya] = key.split(",").map(Number);
      return { x: (xp / 100) * baseWidth, y: ya, value };
    });
  }, [isDiff, clicks.data, clicksConverters.data, baseWidth]);

  // Reset measured height + cached snapshot DOM whenever the snapshot changes.
  useEffect(() => {
    setBackdropHeight(0);
    snapshotDocRef.current = null;
    setDocVersion(0);
  }, [snapshot.data]);

  const handleDocReady = useCallback((doc: Document) => {
    snapshotDocRef.current = doc;
    setDocVersion(v => v + 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPath]);

  const scale = containerWidth > 0 ? Math.min(containerWidth / baseWidth, 1) : 1;
  const leftOffset = containerWidth > 0 ? Math.max(0, (containerWidth - baseWidth * scale) / 2) : 0;

  // Clarity-style area: map each ranked element onto its real geometry in the
  // rendered snapshot DOM, so every clicked region is its own selectable box.
  // Derived entirely from already-captured data — no extra tracking on the site.
  const areaRegions = useMemo(() => {
    void docVersion;
    const doc = snapshotDocRef.current;
    if (view !== "area" || !doc || !elements.data?.length) return [];
    const out: { selector: string; text: string; clicks: number; pct: number; x: number; y: number; w: number; h: number }[] = [];
    for (const e of elements.data) {
      if (!e.element_selector) continue;
      let node: Element | null = null;
      try {
        node = doc.querySelector(e.element_selector);
      } catch {
        node = null;
      }
      if (!node) continue;
      const rect = (node as HTMLElement).getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      out.push({
        selector: e.element_selector,
        text: e.element_text,
        clicks: e.clicks,
        pct: e.percentage,
        x: rect.left,
        y: rect.top,
        w: rect.width,
        h: rect.height,
      });
    }
    // Render larger regions first so smaller nested ones stay clickable on top.
    return out.sort((a, b) => b.w * b.h - a.w * a.h);
  }, [view, elements.data, docVersion, baseWidth, baseHeight]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Cap the heatmap BITMAP resolution. The canvas is CSS-stretched to the full
    // backdrop size, and the heatmap is a blurry overlay (brush radius is width-relative),
    // so a lower-res bitmap is visually identical. Without this, a tall page
    // (e.g. 2005×11783 ≈ 24MP) does a ~94MB per-pixel pass each redraw and freezes the tab.
    const RENDER_MAX_PX = 4_000_000;
    const rScale = Math.min(1, Math.sqrt(RENDER_MAX_PX / Math.max(1, baseWidth * baseHeight)));
    const rW = Math.max(1, Math.round(baseWidth * rScale));
    const rH = Math.max(1, Math.round(baseHeight * rScale));
    canvas.width = rW;
    canvas.height = rH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const scaleHeat = (pts: HeatPoint[]) =>
      rScale === 1 ? pts : pts.map(p => ({ x: p.x * rScale, y: p.y * rScale, value: p.value }));
    const scaleAbs = (pts: HeatmapPoint[]) =>
      rScale === 1 ? pts : pts.map(p => ({ ...p, y_absolute: p.y_absolute * rScale }));
    if (view === "scroll") {
      drawScrollMap(ctx, scroll.data?.buckets ?? [], scroll.data?.foldPercent ?? 0, rW, rH);
    } else if (view === "area") {
      // Region boxes (overlaid as DOM) replace the band canvas when available.
      if (areaRegions.length) ctx.clearRect(0, 0, rW, rH);
      else drawAreaMap(ctx, scaleAbs(clicks.data?.points ?? []), rW, rH);
    } else if (isDiff) {
      drawDiffHeatmap(ctx, { points: scaleHeat(diffPoints), width: rW, height: rH });
    } else if (view === "attention" && attentionMode === "depth") {
      drawAttentionBands(ctx, scaleAbs(attention.data?.points ?? []), rW, rH);
    } else {
      drawHeatmap(ctx, { points: scaleHeat(heatPoints), width: rW, height: rH });
    }
  }, [view, isDiff, attentionMode, attention.data, heatPoints, diffPoints, scroll.data, clicks.data, baseWidth, baseHeight, areaRegions.length]);

  const activeQuery = showInsights ? insights : view === "clicks" || view === "area" ? clicks : view === "attention" ? attention : scroll;
  const isLoading = hasPath && (snapshot.isLoading || activeQuery.isLoading || (isDiff && clicksConverters.isLoading));

  const pointCount = showInsights
    ? (clicksMode === "rage" ? insights.data?.rage.points?.length : insights.data?.dead.points?.length) ?? 0
    : view === "clicks" || view === "area"
      ? clicks.data?.points?.length ?? 0
      : view === "attention"
        ? attention.data?.points?.length ?? 0
        : scroll.data?.buckets?.length ?? 0;
  const showNoData = hasPath && hasSnapshot && !isLoading && pointCount === 0;
  const noDataTitle =
    view === "scroll"
      ? t("No scroll data for this page")
      : view === "attention"
        ? t("No attention data for this page")
        : t("No click data for this page");

  // Badges: filtered elements with position data, rendered at screen-space coords outside the scaled div
  const elementBadges = useMemo(() => {
    if (view !== "clicks" || showInsights) return [];
    return (elements.data ?? []).filter(e => e.avg_x != null && e.avg_y != null).slice(0, 10);
  }, [view, showInsights, elements.data]);

  // Fan out badges that land on (nearly) the same screen spot so each stays
  // individually hoverable instead of being hidden under the one on top.
  const positionedBadges = useMemo(() => {
    void docVersion;
    const doc = snapshotDocRef.current;
    const base = elementBadges.map((e, idx) => {
      // Re-anchor to the element's real position in the rendered snapshot so the
      // pin stays on the element even if the page reflowed since clicks were
      // recorded. Fall back to the stored centroid when the selector can't resolve.
      let baseX = ((e.avg_x ?? 0) / 100) * baseWidth;
      let baseY = e.avg_y ?? 0;
      if (doc && e.element_selector) {
        let node: Element | null = null;
        try {
          node = doc.querySelector(e.element_selector);
        } catch {
          node = null;
        }
        if (node) {
          const rect = (node as HTMLElement).getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            baseX = rect.left + rect.width / 2;
            baseY = rect.top + rect.height / 2;
          }
        }
      }
      return { e, idx, left: leftOffset + baseX * scale, top: baseY * scale };
    });
    const THRESHOLD = 26;
    const FAN_RADIUS = 18;
    const claimed = new Array(base.length).fill(false);
    for (let i = 0; i < base.length; i++) {
      if (claimed[i]) continue;
      const cluster = [i];
      for (let j = i + 1; j < base.length; j++) {
        if (claimed[j]) continue;
        if (Math.hypot(base[i].left - base[j].left, base[i].top - base[j].top) < THRESHOLD) {
          cluster.push(j);
          claimed[j] = true;
        }
      }
      claimed[i] = true;
      if (cluster.length > 1) {
        const cx = cluster.reduce((s, c) => s + base[c].left, 0) / cluster.length;
        const cy = cluster.reduce((s, c) => s + base[c].top, 0) / cluster.length;
        cluster.forEach((c, k) => {
          const angle = (2 * Math.PI * k) / cluster.length - Math.PI / 2;
          base[c].left = cx + Math.cos(angle) * FAN_RADIUS;
          base[c].top = cy + Math.sin(angle) * FAN_RADIUS;
        });
      }
    }
    return base;
  }, [elementBadges, baseWidth, scale, leftOffset, docVersion]);

  const areaBands = useMemo(() => {
    if (view !== "area" || !clicks.data) return [];
    return computeAreaBands(clicks.data.points, clicks.data.totalClicks, baseHeight);
  }, [view, clicks.data, baseHeight]);

  const maxRegionPct = useMemo(() => Math.max(...areaRegions.map(r => r.pct), 0.01), [areaRegions]);

  const attentionBands = useMemo(() => {
    if (!attention.data?.points.length || !baseHeight) return [];
    const bandH = baseHeight / ATTENTION_ZONES;
    return Array.from({ length: ATTENTION_ZONES }, (_, i) => {
      const lo = i * bandH, hi = (i + 1) * bandH;
      const samples = attention.data!.points.filter(p => p.y_absolute >= lo && p.y_absolute < hi).reduce((acc, p) => acc + p.count, 0);
      const total = attention.data!.totalSamples || 1;
      return {
        startPct: Math.round(i * (100 / ATTENTION_ZONES)),
        endPct: Math.round((i + 1) * (100 / ATTENTION_ZONES)),
        samples,
        attentionPct: ((samples / total) * 100).toFixed(2),
      };
    });
  }, [attention.data, baseHeight]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenY = e.clientY - rect.top;
    const screenX = e.clientX - rect.left;
    const yContent = screenY / scale;
    if (view === "attention" && baseHeight) {
      const idx = Math.min(Math.floor((yContent / baseHeight) * ATTENTION_ZONES), ATTENTION_ZONES - 1);
      setAttentionHover({ zoneIdx: Math.max(0, idx), screenX, screenY });
      setScrollHover(null);
    } else if (view === "scroll" && scroll.data?.buckets?.length) {
      const reachPct = interpolateReach(scroll.data.buckets, Math.min(100, (yContent / baseHeight) * 100));
      setScrollHover({ screenY, reachPct });
      setAttentionHover(null);
    } else {
      setAttentionHover(null);
      setScrollHover(null);
    }
  }, [view, baseHeight, scale, scroll.data]);

  const handleMouseLeave = useCallback(() => {
    setAttentionHover(null);
    setScrollHover(null);
  }, []);

  if (!hasPath) {
    return (
      <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center text-neutral-500 dark:text-neutral-400">
        {t("Select a page to view its heatmap.")}
      </div>
    );
  }

  const legendMode = view === "scroll" ? "scroll" : isDiff ? "diff" : "heat";

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <div style={{ height: baseHeight * scale, position: "relative", width: "100%" }}>
            {/* Scaled backdrop + canvas — badges are NOT inside here so they don't shrink */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: leftOffset,
                width: baseWidth,
                height: baseHeight,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {snapshot.data?.events?.length ? (
                <HeatmapBackdrop
                  events={snapshot.data.events}
                  baseWidth={baseWidth}
                  baseHeight={baseHeight}
                  onHeightChange={h => setBackdropHeight(prev => Math.max(prev, h))}
                  onDocReady={handleDocReady}
                />
              ) : (
                <div
                  style={{ width: baseWidth, height: baseHeight }}
                  className="bg-neutral-100 dark:bg-neutral-900 flex items-start justify-center pt-16"
                >
                  {!snapshot.isLoading && (
                    <div className="text-center text-neutral-400 dark:text-neutral-600 text-sm px-8 max-w-xs">
                      <div className="text-2xl mb-2">📸</div>
                      <div className="font-medium mb-1">No backdrop captured yet</div>
                      <div className="text-xs">
                        Appears after the first sampled visit to this page. Visit in incognito to trigger immediately.
                      </div>
                    </div>
                  )}
                </div>
              )}
              <canvas
                ref={canvasRef}
                style={{ position: "absolute", top: 0, left: 0, width: baseWidth, height: baseHeight, pointerEvents: "none", opacity }}
              />
            </div>

            {showNoData && (
              <div className="absolute inset-0 z-40 flex items-start justify-center pt-24 bg-neutral-950/30">
                <div className="flex flex-col items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white/95 dark:bg-neutral-900/95 px-6 py-5 text-center shadow-lg">
                  <MousePointerClick className="h-6 w-6 text-neutral-400 dark:text-neutral-500" />
                  <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{noDataTitle}</div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {t("Data will appear once users interact with this page")}
                  </div>
                </div>
              </div>
            )}

            {/* Area regions — one selectable box per clicked element, like Clarity */}
            {view === "area" && areaRegions.map((r, idx) => {
              const ratio = r.pct / maxRegionPct;
              const hue = Math.round(210 - 210 * ratio);
              const isHovered = hoveredRegion === idx;
              const left = leftOffset + r.x * scale;
              const top = r.y * scale;
              const w = r.w * scale;
              const h = r.h * scale;
              const showLabel = w > 34 && h > 18;
              return (
                <div
                  key={`${r.selector}-${idx}`}
                  className="absolute flex items-center justify-center rounded-sm"
                  style={{
                    left,
                    top,
                    width: w,
                    height: h,
                    zIndex: isHovered ? 19 : 12,
                    background: `hsla(${hue}, 85%, 50%, ${0.22 + 0.32 * ratio + (isHovered ? 0.18 : 0)})`,
                    border: `1.5px solid hsla(${hue}, 85%, 45%, ${isHovered ? 1 : 0.8})`,
                    cursor: "default",
                  }}
                  onMouseEnter={() => setHoveredRegion(idx)}
                  onMouseLeave={() => setHoveredRegion(null)}
                >
                  {showLabel && (
                    <span className="rounded bg-black/55 px-1.5 py-0.5 text-[11px] font-bold text-white shadow-sm">
                      {r.pct}%
                    </span>
                  )}
                </div>
              );
            })}

            {/* Area region tooltip */}
            {view === "area" && hoveredRegion != null && areaRegions[hoveredRegion] && (() => {
              const r = areaRegions[hoveredRegion];
              const left = leftOffset + (r.x + r.w / 2) * scale;
              const top = Math.max(8, r.y * scale - 8);
              return (
                <div
                  className="pointer-events-none absolute z-30 max-w-[260px] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 shadow-lg"
                  style={{ left, top, transform: "translate(-50%, -100%)" }}
                >
                  {r.text && (
                    <div className="mb-0.5 truncate text-xs font-medium text-neutral-800 dark:text-neutral-100">{r.text}</div>
                  )}
                  <div>
                    <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{r.clicks.toLocaleString()}</span>
                    <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">clicks ({r.pct}%)</span>
                  </div>
                </div>
              );
            })()}

            {/* Click badges rendered at screen-space positions so they stay at a fixed size */}
            {view === "clicks" && !showInsights && positionedBadges.map(({ e, idx, left, top }) => {
              const isHovered = hoveredBadge?.idx === idx;
              return (
                <div
                  key={e.element_selector}
                  className="absolute"
                  style={{ left, top, zIndex: isHovered ? 20 : 10, transform: "translate(-50%, -50%)" }}
                >
                  <div
                    className={`w-7 h-7 rounded-full border-2 border-white dark:border-neutral-900 flex items-center justify-center text-[11px] font-bold text-white cursor-default shadow-md transition-transform ${
                      isHovered ? "bg-blue-600 scale-125" : "bg-blue-500"
                    }`}
                    onMouseEnter={() => setHoveredBadge({ idx, screenLeft: left, screenTop: top })}
                    onMouseLeave={() => setHoveredBadge(null)}
                  >
                    {idx + 1}
                  </div>
                </div>
              );
            })}

            {/* Badge tooltip — rendered at container level to escape overflow-hidden clipping */}
            {hoveredBadge && (() => {
              const e = elementBadges[hoveredBadge.idx];
              if (!e) return null;
              const totalClicks = clicks.data?.totalClicks || 1;
              const pct = ((e.clicks / totalClicks) * 100).toFixed(2);
              const tipTop = Math.max(8, hoveredBadge.screenTop - 40);
              return (
                <div
                  className="pointer-events-none absolute z-30 whitespace-nowrap rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 shadow-lg"
                  style={{ left: hoveredBadge.screenLeft, top: tipTop, transform: "translateX(-50%)" }}
                >
                  <span className="text-sm font-bold text-neutral-900 dark:text-neutral-100">{e.clicks.toLocaleString()}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-1">clicks ({pct}%)</span>
                </div>
              );
            })()}
          </div>

          {/* Scroll hover: horizontal line + centered reach tooltip */}
          {view === "scroll" && scrollHover && (
            <>
              <div
                className="pointer-events-none absolute left-0 right-0 z-20 h-px bg-neutral-900/60 dark:bg-white/60"
                style={{ top: scrollHover.screenY }}
              />
              <div
                className="pointer-events-none absolute z-30 flex items-baseline gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg px-3 py-2"
                style={{ left: "50%", transform: "translateX(-50%)", top: scrollHover.screenY + 8 }}
              >
                <span className="text-2xl font-black text-neutral-900 dark:text-neutral-100 leading-none">
                  {scrollHover.reachPct.toFixed(2)}%
                </span>
                <span className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-tight max-w-[80px]">
                  of users reached this point
                </span>
              </div>
            </>
          )}

          {/* Attention hover tooltip */}
          {view === "attention" && attentionHover && attentionBands[attentionHover.zoneIdx] && (
            <div
              className="pointer-events-none absolute z-30 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg px-3 py-2 text-xs"
              style={{ left: attentionHover.screenX + 14, top: attentionHover.screenY - 10, maxWidth: 200 }}
            >
              <div className="font-semibold text-neutral-800 dark:text-neutral-100 mb-1">
                {attentionBands[attentionHover.zoneIdx].startPct}–{attentionBands[attentionHover.zoneIdx].endPct}% scrolled
              </div>
              <div className="flex justify-between gap-4 text-neutral-500 dark:text-neutral-400">
                <span>Samples</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100">
                  {attentionBands[attentionHover.zoneIdx].samples.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between gap-4 text-neutral-500 dark:text-neutral-400">
                <span>% of attention</span>
                <span className="font-medium text-neutral-800 dark:text-neutral-100">
                  {attentionBands[attentionHover.zoneIdx].attentionPct}%
                </span>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/50 text-sm text-neutral-600 dark:text-neutral-300">
              {t("Loading…")}
            </div>
          )}
        </div>
      </div>

      <div className="w-full lg:w-72 shrink-0 flex flex-col gap-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-100px)] lg:overflow-y-auto">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
          {view !== "area" && <HeatmapLegend mode={legendMode} />}
          <div className="grid grid-cols-2 gap-2 text-sm">
            {view === "clicks" && !showInsights && (
              <Stat label={t("Total clicks")} value={clicks.data?.totalClicks ?? 0} />
            )}
            {view === "clicks" && clicksMode === "rage" && (
              <Stat label={t("Rage clicks")} value={insights.data?.rage.total ?? 0} />
            )}
            {view === "clicks" && clicksMode === "dead" && (
              <Stat label={t("Dead clicks")} value={insights.data?.dead.total ?? 0} />
            )}
            {view === "area" && (
              <Stat label={t("Total clicks")} value={clicks.data?.totalClicks ?? 0} />
            )}
            {view === "attention" && (
              <>
                <Stat label={t("Samples")} value={attention.data?.totalSamples ?? 0} />
                <Stat label={t("Sessions")} value={attention.data?.sessions ?? 0} />
              </>
            )}
            {view === "scroll" && (
              <>
                <Stat label={t("Sessions")} value={scroll.data?.totalSessions ?? 0} />
                <Stat label={t("Avg. scroll")} value={`${scroll.data?.averageScrollDepth ?? 0}%`} />
              </>
            )}
          </div>
        </div>

        {view === "clicks" && !showInsights && (
          <HeatmapElementList
            title={t("Most clicked")}
            rows={(elements.data ?? []).map(e => ({ selector: e.element_selector, text: e.element_text, value: e.clicks }))}
            emptyLabel={t("No element clicks yet.")}
          />
        )}
        {view === "clicks" && clicksMode === "rage" && (
          <HeatmapElementList
            title={t("Top rage elements")}
            rows={(insights.data?.topRageElements ?? []).map(e => ({ selector: e.element_selector, text: e.element_text, value: e.count }))}
            emptyLabel={t("No rage clicks detected.")}
          />
        )}
        {view === "clicks" && clicksMode === "dead" && (
          <HeatmapElementList
            title={t("Top dead elements")}
            rows={(insights.data?.topDeadElements ?? []).map(e => ({ selector: e.element_selector, text: e.element_text, value: e.count }))}
            emptyLabel={t("No dead clicks detected.")}
          />
        )}
        {view === "scroll" && (
          <ScrollDataTable buckets={scroll.data?.buckets ?? []} totalSessions={scroll.data?.totalSessions ?? 0} />
        )}
        {view === "attention" && (
          <AttentionDataTable
            points={attention.data?.points ?? []}
            totalSamples={attention.data?.totalSamples ?? 0}
            pageHeight={attention.data?.pageHeight ?? baseHeight}
          />
        )}
        {view === "area" && areaRegions.length > 0 && (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
              <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">
                Areas in order of appearance
              </span>
              <span className="ml-1.5 text-xs text-neutral-400">{areaRegions.length}</span>
            </div>
            <div className="overflow-y-auto max-h-[480px]">
              {areaRegions
                .map((r, i) => ({ r, i }))
                .sort((a, b) => a.r.y - b.r.y)
                .map(({ r, i }) => (
                  <div
                    key={`${r.selector}-${i}`}
                    className={`flex items-center gap-2 px-3 py-2 border-b border-neutral-100 dark:border-neutral-800/50 cursor-default ${
                      hoveredRegion === i ? "bg-neutral-100 dark:bg-neutral-800/60" : "hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                    }`}
                    onMouseEnter={() => setHoveredRegion(i)}
                    onMouseLeave={() => setHoveredRegion(null)}
                  >
                    <span className="flex-1 min-w-0 truncate text-xs text-neutral-700 dark:text-neutral-300">
                      {r.text || r.selector}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{r.clicks}</span>
                    <span className="w-10 shrink-0 text-right text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      {r.pct}%
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
        {view === "area" && areaRegions.length === 0 && areaBands.length > 0 && (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
            <div className="px-3 py-2 border-b border-neutral-200 dark:border-neutral-800">
              <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Click Distribution</span>
            </div>
            <div className="overflow-y-auto max-h-[480px]">
              {areaBands.map(b => (
                <div
                  key={b.index}
                  className="flex items-center gap-2 px-3 py-2 border-b border-neutral-100 dark:border-neutral-800/50 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
                >
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 w-24 shrink-0">
                    Section {b.index} ({b.startPct}–{b.endPct}%)
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-700 overflow-hidden">
                    <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(b.pct * 5, 100)}%` }} />
                  </div>
                  <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 w-10 text-right shrink-0">
                    {b.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-lg font-semibold text-neutral-800 dark:text-neutral-100">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
    </div>
  );
}
