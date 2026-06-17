"use client";

import { useExtracted } from "next-intl";
import React, { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronsUpDown, Monitor, MousePointerClick, Smartphone, Tablet } from "lucide-react";
import { useGetGoals } from "@/api/analytics/hooks/goals/useGetGoals";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useGetHeatmapPages } from "@/api/analytics/hooks/heatmap/useHeatmap";
import {
  HeatmapAttentionMode,
  HeatmapClicksMode,
  HeatmapDevice,
  HeatmapSegmentUI,
  HeatmapView,
  useHeatmapStore,
} from "./heatmapStore";
import { SnapshotPicker } from "./SnapshotPicker";

const CLICKS_MODES: { value: HeatmapClicksMode; label: string }[] = [
  { value: "all", label: "All clicks" },
  { value: "dead", label: "Dead clicks" },
  { value: "rage", label: "Rage clicks" },
  { value: "error", label: "Error clicks" },
  { value: "first", label: "First clicks" },
  { value: "last", label: "Last clicks" },
];

const NON_CLICK_VIEWS: { value: HeatmapView; label: string }[] = [
  { value: "scroll", label: "Scroll" },
];

const CLICK_TABS: { value: HeatmapView; label: string }[] = [
  { value: "clicks", label: "Click" },
  { value: "area", label: "Area" },
];

const ATTENTION_MODES: { value: HeatmapAttentionMode; label: string }[] = [
  { value: "cursor", label: "Cursor (2D heat)" },
  { value: "depth", label: "Depth (scroll dwell)" },
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

// Looks like one button (chevron inset, no divider) but splits behaviour: the body
// runs the primary action, the chevron opens the dropdown.
function SplitButton({
  active,
  icon,
  label,
  ariaLabel,
  onPrimary,
  menu,
}: {
  active: boolean;
  icon?: React.ReactNode;
  label: React.ReactNode;
  ariaLabel: string;
  onPrimary: () => void;
  menu: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <Button variant={active ? "default" : "outline"} size="sm" onClick={onPrimary} className="pr-1.5">
        {icon}
        {label}
        <DropdownMenuTrigger asChild unstyled>
          <span role="button" tabIndex={0} aria-label={ariaLabel} onClick={e => e.stopPropagation()}>
            <ChevronDown />
          </span>
        </DropdownMenuTrigger>
      </Button>
      {menu}
    </DropdownMenu>
  );
}

export function HeatmapToolbar() {
  const t = useExtracted();
  const {
    hostname,
    pathname,
    device,
    view,
    clicksMode,
    attentionMode,
    segment,
    goalId,
    setPage,
    setDevice,
    setView,
    setClicksMode,
    setAttentionMode,
    setGoalId,
    setSegment,
  } = useHeatmapStore();

  const { data: pages, isLoading: pagesLoading } = useGetHeatmapPages(device || undefined);
  const { data: goalsData } = useGetGoals({ page: 1, pageSize: 100 });
  const goals = goalsData?.data ?? [];

  // Keep the persisted page if it still exists for this site; otherwise default to the
  // most-visited page. This lets a refresh stay on the user's chosen URL.
  useEffect(() => {
    if (!pages || pages.length === 0) return;
    const stillValid = pathname && pages.some(p => p.hostname === hostname && p.pathname === pathname);
    if (!stillValid) {
      setPage(pages[0].hostname, pages[0].pathname);
    }
  }, [hostname, pathname, pages, setPage]);

  const [pageOpen, setPageOpen] = useState(false);
  const selectedKey = hostname && pathname ? encodePageKey(hostname, pathname) : undefined;
  const selectedPage = (pages ?? []).find(p => encodePageKey(p.hostname, p.pathname) === selectedKey);
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
  const isClickFamily = view === "clicks" || view === "area";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-neutral-500 dark:text-neutral-400 shrink-0">{t("Page")}</span>
          <Popover open={pageOpen} onOpenChange={setPageOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={pageOpen}
                disabled={pagesLoading || (pages?.length ?? 0) === 0}
                className="w-full md:w-[480px] justify-between font-normal"
              >
                <span className="truncate font-mono text-xs">
                  {selectedPage
                    ? `https://${selectedPage.hostname}${selectedPage.pathname}`
                    : pagesLoading
                      ? t("Loading…")
                      : t("No pages with heatmap data")}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[480px] max-w-[90vw] p-0" align="start">
              <Command>
                <CommandInput placeholder={t("Search pages…")} />
                <CommandList>
                  <CommandEmpty>{t("No pages found.")}</CommandEmpty>
                  <CommandGroup>
                    {(pages ?? []).map(p => {
                      const key = encodePageKey(p.hostname, p.pathname);
                      const fullUrl = `https://${p.hostname}${p.pathname}`;
                      return (
                        <CommandItem
                          key={key}
                          value={fullUrl}
                          onSelect={() => {
                            handlePageChange(key);
                            setPageOpen(false);
                          }}
                        >
                          <Check
                            className={cn("mr-2 h-4 w-4 shrink-0", selectedKey === key ? "opacity-100" : "opacity-0")}
                          />
                          <span className="flex-1 truncate font-mono text-xs">{fullUrl}</span>
                          <span className="ml-2 shrink-0 text-xs text-neutral-400">
                            {p.sessions.toLocaleString()} {t("sessions")}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
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
          {/* Clicks split button — body = All clicks; chevron = filter dropdown */}
          <SplitButton
            active={isClickFamily}
            icon={<MousePointerClick size={13} className="mr-1.5" />}
            label={view === "area" ? t("Clicks") : clicksLabel}
            ariaLabel={t("Click options")}
            onPrimary={() => { setView("clicks"); setClicksMode("all"); }}
            menu={
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
            }
          />

          {/* Click | Area sub-toggle — always visible */}
          <div className="ml-0.5 flex items-center rounded-md border border-neutral-200 dark:border-neutral-700 p-0.5">
            {CLICK_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setView(tab.value)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  view === tab.value
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Non-click views (Scroll) */}
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

          {/* Attention split button — body = 2D cursor heat; chevron = mode dropdown */}
          <SplitButton
            active={view === "attention"}
            label={t("Attention")}
            ariaLabel={t("Attention options")}
            onPrimary={() => { setView("attention"); setAttentionMode("cursor"); }}
            menu={
              <DropdownMenuContent align="start" className="min-w-[180px]">
                {ATTENTION_MODES.map(m => (
                  <DropdownMenuItem
                    key={m.value}
                    onSelect={() => { setView("attention"); setAttentionMode(m.value); }}
                    className={view === "attention" && attentionMode === m.value ? "font-semibold" : ""}
                  >
                    {m.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            }
          />
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={goalId != null ? String(goalId) : "none"}
            onValueChange={value => {
              // A goal only filters when paired with a segment, so picking one jumps to
              // Converters (and clearing it returns to All visitors) — otherwise it looks inert.
              if (value === "none") {
                setGoalId(null);
                if (segment !== "all") setSegment("all");
              } else {
                setGoalId(Number(value));
                if (segment === "all") setSegment("converters");
              }
            }}
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
