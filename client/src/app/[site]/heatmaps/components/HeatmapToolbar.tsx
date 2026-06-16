"use client";

import { useExtracted } from "next-intl";
import React, { useEffect } from "react";
import { ChevronDown, Monitor, MousePointerClick, Smartphone, Tablet } from "lucide-react";
import { useGetGoals } from "@/api/analytics/hooks/goals/useGetGoals";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useGetHeatmapPages } from "@/api/analytics/hooks/heatmap/useHeatmap";
import { HeatmapClicksMode, HeatmapDevice, HeatmapSegmentUI, HeatmapView, useHeatmapStore } from "./heatmapStore";
import { SnapshotPicker } from "./SnapshotPicker";

const CLICKS_MODES: { value: HeatmapClicksMode; label: string }[] = [
  { value: "all", label: "All clicks" },
  { value: "rage", label: "Rage clicks" },
  { value: "dead", label: "Dead clicks" },
];

const NON_CLICK_VIEWS: { value: HeatmapView; label: string }[] = [
  { value: "scroll", label: "Scroll" },
  { value: "attention", label: "Attention" },
  { value: "area", label: "Area" },
];

const DEVICES: { value: HeatmapDevice; label: string; icon: React.ReactNode }[] = [
  { value: "Desktop", label: "Desktop", icon: <Monitor size={15} /> },
  { value: "Mobile", label: "Mobile", icon: <Smartphone size={15} /> },
  { value: "Tablet", label: "Tablet", icon: <Tablet size={15} /> },
];

const encodePageKey = (hostname: string, pathname: string) => `${hostname}||${pathname}`;
const decodePageKey = (key: string) => {
  const idx = key.indexOf("||");
  return idx === -1
    ? { hostname: "", pathname: key }
    : { hostname: key.slice(0, idx), pathname: key.slice(idx + 2) };
};

export function HeatmapToolbar() {
  const t = useExtracted();
  const {
    hostname,
    pathname,
    device,
    view,
    clicksMode,
    segment,
    goalId,
    setPage,
    setDevice,
    setView,
    setClicksMode,
    setGoalId,
    setSegment,
  } = useHeatmapStore();

  const { data: pages, isLoading: pagesLoading } = useGetHeatmapPages(device || undefined);
  const { data: goalsData } = useGetGoals({ page: 1, pageSize: 100 });
  const goals = goalsData?.data ?? [];

  useEffect(() => {
    if (!pathname && pages && pages.length > 0) {
      setPage(pages[0].hostname, pages[0].pathname);
    }
  }, [pathname, pages, setPage]);

  const selectedKey = hostname && pathname ? encodePageKey(hostname, pathname) : undefined;
  const handlePageChange = (key: string) => {
    const { hostname, pathname } = decodePageKey(key);
    setPage(hostname, pathname);
  };

  useEffect(() => {
    if (segment === "diff" && view !== "clicks") {
      setSegment("all");
    }
  }, [view, segment, setSegment]);

  const hasGoal = goalId != null;
  const onSegmentChange = (value: string) => setSegment(value as HeatmapSegmentUI);

  const clicksLabel = CLICKS_MODES.find(m => m.value === clicksMode)?.label ?? "Clicks";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-neutral-500 dark:text-neutral-400 shrink-0">{t("Page")}</span>
          <Select
            value={selectedKey}
            onValueChange={handlePageChange}
            disabled={pagesLoading || (pages?.length ?? 0) === 0}
          >
            <SelectTrigger className="w-full md:w-[480px]">
              <SelectValue placeholder={pagesLoading ? t("Loading…") : t("No pages with heatmap data")} />
            </SelectTrigger>
            <SelectContent>
              {(pages ?? []).map(p => {
                const key = encodePageKey(p.hostname, p.pathname);
                const fullUrl = `https://${p.hostname}${p.pathname}`;
                return (
                  <SelectItem key={key} value={key}>
                    <span className="truncate font-mono text-xs">{fullUrl}</span>
                    <span className="ml-2 text-xs text-neutral-400">{p.events.toLocaleString()}</span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>

        {/* Device filter — icon-only buttons with tooltips */}
        <TooltipProvider delayDuration={400}>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {DEVICES.map(d => (
                <Tooltip key={d.value}>
                  <TooltipTrigger asChild>
                    <Button
                      variant={device === d.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setDevice(d.value)}
                      className="px-2.5"
                      aria-label={d.label}
                    >
                      {d.icon}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{d.label}</TooltipContent>
                </Tooltip>
              ))}
            </div>
            <SnapshotPicker />
          </div>
        </TooltipProvider>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-1">
          {/* Clicks button — dropdown for sub-mode; variant drives active state */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant={view === "clicks" ? "default" : "outline"}
                size="sm"
              >
                <MousePointerClick size={13} className="mr-1.5" />
                {clicksLabel}
                <ChevronDown size={12} className="ml-1.5 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[150px]">
              {CLICKS_MODES.map(m => (
                <DropdownMenuItem
                  key={m.value}
                  onSelect={() => { setView("clicks"); setClicksMode(m.value); }}
                  className={clicksMode === m.value && view === "clicks" ? "font-semibold" : ""}
                >
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Non-click views */}
          {NON_CLICK_VIEWS.map(v => (
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
