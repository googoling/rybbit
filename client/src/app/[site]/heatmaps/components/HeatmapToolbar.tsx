"use client";

import { useExtracted } from "next-intl";
import { useEffect } from "react";
import { useGetGoals } from "@/api/analytics/hooks/goals/useGetGoals";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetHeatmapPages } from "@/api/analytics/hooks/heatmap/useHeatmap";
import { HeatmapDevice, HeatmapSegmentUI, HeatmapView, useHeatmapStore } from "./heatmapStore";

const VIEWS: { value: HeatmapView; label: string }[] = [
  { value: "clicks", label: "Clicks" },
  { value: "attention", label: "Attention" },
  { value: "scroll", label: "Scroll" },
  { value: "insights", label: "Rage & dead" },
];

const DEVICES: { value: HeatmapDevice; label: string }[] = [
  { value: "Desktop", label: "Desktop" },
  { value: "Mobile", label: "Mobile" },
  { value: "Tablet", label: "Tablet" },
];

export function HeatmapToolbar() {
  const t = useExtracted();
  const { pathname, device, view, segment, goalId, setPathname, setDevice, setView, setGoalId, setSegment } =
    useHeatmapStore();

  const { data: pages, isLoading: pagesLoading } = useGetHeatmapPages(device || undefined);
  const { data: goalsData } = useGetGoals({ page: 1, pageSize: 100 });
  const goals = goalsData?.data ?? [];

  // Default to the most active page once the list loads.
  useEffect(() => {
    if (!pathname && pages && pages.length > 0) {
      setPathname(pages[0].pathname);
    }
  }, [pathname, pages, setPathname]);

  // Diff only applies to the click map; fall back if the view changes away from clicks.
  useEffect(() => {
    if (segment === "diff" && view !== "clicks") {
      setSegment("all");
    }
  }, [view, segment, setSegment]);

  const hasGoal = goalId != null;

  const onSegmentChange = (value: string) => setSegment(value as HeatmapSegmentUI);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-neutral-500 dark:text-neutral-400 shrink-0">{t("Page")}</span>
          <Select value={pathname} onValueChange={setPathname} disabled={pagesLoading || (pages?.length ?? 0) === 0}>
            <SelectTrigger className="w-full md:w-96">
              <SelectValue placeholder={pagesLoading ? t("Loading…") : t("No pages with heatmap data")} />
            </SelectTrigger>
            <SelectContent>
              {(pages ?? []).map(p => (
                <SelectItem key={p.pathname} value={p.pathname}>
                  <span className="truncate">{p.pathname}</span>
                  <span className="ml-2 text-xs text-neutral-400">{p.events.toLocaleString()}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          {DEVICES.map(d => (
            <Button
              key={d.value || "all"}
              variant={device === d.value ? "default" : "outline"}
              size="sm"
              onClick={() => setDevice(d.value)}
            >
              {d.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-1">
          {VIEWS.map(v => (
            <Button
              key={v.value}
              variant={view === v.value ? "default" : "outline"}
              size="sm"
              onClick={() => setView(v.value)}
            >
              {v.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={goalId != null ? String(goalId) : "none"}
            onValueChange={value => setGoalId(value === "none" ? null : Number(value))}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder={t("Conversion goal")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("No goal")}</SelectItem>
              {goals.map(g => (
                <SelectItem key={g.goalId} value={String(g.goalId)}>
                  {g.name || (g.goalType === "path" ? g.config.pathPattern : g.config.eventName) || `Goal ${g.goalId}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={segment} onValueChange={onSegmentChange}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("All visitors")}</SelectItem>
              <SelectItem value="converters" disabled={!hasGoal}>
                {t("Converters")}
              </SelectItem>
              <SelectItem value="non_converters" disabled={!hasGoal}>
                {t("Non-converters")}
              </SelectItem>
              {view === "clicks" && (
                <SelectItem value="diff" disabled={!hasGoal}>
                  {t("Diff (converters vs all)")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
