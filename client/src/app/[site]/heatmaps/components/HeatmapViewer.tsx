"use client";

import { useExtracted } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { HeatmapBackdrop } from "./HeatmapBackdrop";
import { HeatmapElementList } from "./HeatmapElementList";
import { HeatmapLegend } from "./HeatmapLegend";
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

// Scroll reach as a vertical heat: warm where most visitors reached, fading deeper.
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

function toHeatPoints(points: HeatmapPoint[], baseWidth: number): HeatPoint[] {
  return points.map(p => ({ x: (p.x_percent / 100) * baseWidth, y: p.y_absolute, value: p.count }));
}

export function HeatmapViewer() {
  const t = useExtracted();
  const { pathname, device, view, segment, goalId } = useHeatmapStore();
  const deviceParam = device || undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const isDiff = view === "clicks" && segment === "diff";
  const baseSegment: HeatmapSegment = segment === "diff" ? "all" : segment;
  const hasPath = !!pathname;

  const snapshot = useGetHeatmapSnapshot(pathname, deviceParam, hasPath);

  const clicks = useGetClickHeatmap({
    pathname,
    device: deviceParam,
    goalId,
    segment: baseSegment,
    enabled: view === "clicks" && hasPath,
  });
  const clicksConverters = useGetClickHeatmap({
    pathname,
    device: deviceParam,
    goalId,
    segment: "converters",
    enabled: isDiff && !!goalId && hasPath,
  });
  const elements = useGetRankedElements({
    pathname,
    device: deviceParam,
    goalId,
    segment: baseSegment,
    enabled: view === "clicks" && hasPath,
  });
  const attention = useGetAttentionMap({
    pathname,
    device: deviceParam,
    goalId,
    segment: baseSegment,
    enabled: view === "attention" && hasPath,
  });
  const scroll = useGetScrollMap({
    pathname,
    device: deviceParam,
    goalId,
    segment: baseSegment,
    enabled: view === "scroll" && hasPath,
  });
  const insights = useGetClickInsights({
    pathname,
    device: deviceParam,
    goalId,
    segment: baseSegment,
    enabled: view === "insights" && hasPath,
  });

  const maxY = useMemo(() => {
    let m = 0;
    const arrays = [
      clicks.data?.points,
      attention.data?.points,
      insights.data?.rage.points,
      insights.data?.dead.points,
    ];
    for (const arr of arrays) {
      if (arr) for (const p of arr) if (p.y_absolute > m) m = p.y_absolute;
    }
    return m;
  }, [clicks.data, attention.data, insights.data]);

  // The captured viewport width (rrweb Meta event = window.innerWidth at capture). This is the
  // width the page was actually laid out at, so the backdrop must reflow at THIS width — not
  // page_width (scrollWidth), which inflates on horizontal overflow and would reflow a mobile
  // page into its desktop layout.
  const viewportWidth = useMemo(() => {
    const meta = (snapshot.data?.events ?? []).find((e: any) => e?.type === 4);
    return meta?.data?.width || 0;
  }, [snapshot.data]);

  // Anchor the stage to the captured backdrop so the heat canvas shares its exact coordinate
  // space (points past pageHeight just clip). Fall back to data-derived sizing only when no
  // snapshot exists, so a data-only heatmap still renders.
  const hasSnapshot = !!snapshot.data?.events?.length && snapshot.data.pageHeight > 0;
  const baseWidth = hasSnapshot
    ? viewportWidth || snapshot.data!.pageWidth || 1280
    : Math.max(clicks.data?.pageWidth || attention.data?.pageWidth || scroll.data?.pageWidth || 1280, 320);
  const baseHeight = hasSnapshot
    ? snapshot.data!.pageHeight
    : Math.max(
        clicks.data?.pageHeight || 0,
        attention.data?.pageHeight || 0,
        scroll.data?.pageHeight || 0,
        maxY + 120,
        600
      );

  const heatPoints = useMemo(() => {
    let points: HeatmapPoint[] = [];
    if (view === "clicks") points = clicks.data?.points ?? [];
    else if (view === "attention") points = attention.data?.points ?? [];
    else if (view === "insights")
      points = [...(insights.data?.rage.points ?? []), ...(insights.data?.dead.points ?? [])];
    return toHeatPoints(points, baseWidth);
  }, [view, clicks.data, attention.data, insights.data, baseWidth]);

  const diffPoints = useMemo(() => {
    if (!isDiff) return [];
    const all = clicks.data;
    const conv = clicksConverters.data;
    if (!all || !conv) return [];
    const allTotal = all.totalClicks || 1;
    const convTotal = conv.totalClicks || 1;
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

  // Track available width to scale the (page-sized) stage down to fit the column. Depends on
  // hasPath because the stage div (containerRef) only mounts once a page is selected — without
  // this the observer attaches to nothing, containerWidth stays 0, and scale wrongly stays 1.
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

  // Paint the active overlay onto the canvas at full (page) resolution.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = baseWidth;
    canvas.height = baseHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (view === "scroll") {
      drawScrollMap(ctx, scroll.data?.buckets ?? [], scroll.data?.foldPercent ?? 0, baseWidth, baseHeight);
    } else if (isDiff) {
      drawDiffHeatmap(ctx, { points: diffPoints, width: baseWidth, height: baseHeight });
    } else {
      drawHeatmap(ctx, { points: heatPoints, width: baseWidth, height: baseHeight });
    }
  }, [view, isDiff, heatPoints, diffPoints, scroll.data, baseWidth, baseHeight]);

  const activeQuery =
    view === "clicks" ? clicks : view === "attention" ? attention : view === "scroll" ? scroll : insights;
  const isLoading = hasPath && (snapshot.isLoading || activeQuery.isLoading || (isDiff && clicksConverters.isLoading));

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
        >
          <div style={{ height: baseHeight * scale, position: "relative", width: "100%" }}>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: baseWidth,
                height: baseHeight,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {snapshot.data?.events?.length ? (
                <HeatmapBackdrop events={snapshot.data.events} baseWidth={baseWidth} baseHeight={baseHeight} />
              ) : (
                <div style={{ width: baseWidth, height: baseHeight }} className="bg-white dark:bg-neutral-900" />
              )}
              <canvas
                ref={canvasRef}
                style={{ position: "absolute", top: 0, left: 0, width: baseWidth, height: baseHeight, pointerEvents: "none" }}
              />
            </div>
          </div>
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/50 text-sm text-neutral-600 dark:text-neutral-300">
              {t("Loading…")}
            </div>
          )}
        </div>
        {!snapshot.isLoading && !snapshot.data?.events?.length && (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
            {t("No page backdrop captured yet — it appears after a sampled visit to this page.")}
          </p>
        )}
      </div>

      <div className="w-full lg:w-72 shrink-0 space-y-3">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
          <HeatmapLegend mode={legendMode} />
          <div className="grid grid-cols-2 gap-2 text-sm">
            {view === "clicks" && (
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
            {view === "insights" && (
              <>
                <Stat label={t("Rage clicks")} value={insights.data?.rage.total ?? 0} />
                <Stat label={t("Dead clicks")} value={insights.data?.dead.total ?? 0} />
              </>
            )}
          </div>
        </div>

        {view === "clicks" && (
          <HeatmapElementList
            title={t("Most clicked")}
            rows={(elements.data ?? []).map(e => ({
              selector: e.element_selector,
              text: e.element_text,
              value: e.clicks,
            }))}
            emptyLabel={t("No element clicks yet.")}
          />
        )}
        {view === "insights" && (
          <>
            <HeatmapElementList
              title={t("Top rage elements")}
              rows={(insights.data?.topRageElements ?? []).map(e => ({
                selector: e.element_selector,
                text: e.element_text,
                value: e.count,
              }))}
              emptyLabel={t("No rage clicks detected.")}
            />
            <HeatmapElementList
              title={t("Top dead elements")}
              rows={(insights.data?.topDeadElements ?? []).map(e => ({
                selector: e.element_selector,
                text: e.element_text,
                value: e.count,
              }))}
              emptyLabel={t("No dead clicks detected.")}
            />
          </>
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
