"use client";

import { useExtracted } from "next-intl";
import React from "react";
import { ChevronDown, Monitor, MousePointerClick, Smartphone, Tablet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  HeatmapAttentionMode,
  HeatmapClicksMode,
  HeatmapDevice,
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

// Shared segmented-control styling so every toolbar control matches the device switcher.
const GROUP = "flex items-center rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5";
const pill = (active: boolean) =>
  cn(
    "flex items-center gap-1.5 h-8 px-3 text-sm rounded-md transition-colors cursor-pointer",
    active
      ? "bg-neutral-750 text-white"
      : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200"
  );

// A segmented pill whose body runs the primary action and whose caret opens a dropdown.
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
      <div className={cn(GROUP, active && "dark:bg-neutral-750")}>
        <button type="button" onClick={onPrimary} className={cn(pill(active), "px-0 pl-2")}>
          {icon}
          {label}
        </button>
        <DropdownMenuTrigger asChild unstyled>
          <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center px-2 py-2",
              active ? "text-white" : "text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200"
            )}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
      </div>
      {menu}
    </DropdownMenu>
  );
}

export function HeatmapToolbar() {
  const t = useExtracted();
  const { device, view, clicksMode, attentionMode, opacity, setDevice, setView, setClicksMode, setAttentionMode, setOpacity } =
    useHeatmapStore();

  const clicksLabel = CLICKS_MODES.find(m => m.value === clicksMode)?.label ?? "Clicks";
  const isClickFamily = view === "clicks" || view === "area";

  return (
    <div className="flex flex-wrap items-center justify-between gap-y-2">
      {/* Left: view controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Clicks split — body = All clicks; caret = filter dropdown */}
        <SplitButton
          active={isClickFamily}
          icon={<MousePointerClick size={13} />}
          label={view === "area" ? t("Clicks") : clicksLabel}
          ariaLabel={t("Click options")}
          onPrimary={() => { setView("clicks"); setClicksMode("all"); }}
          menu={
            <DropdownMenuContent align="start" className="min-w-[150px]">
              {CLICKS_MODES.map(m => (
                <DropdownMenuItem
                  key={m.value}
                  onSelect={() => { setView("clicks"); setClicksMode(m.value); }}
                  className={cn("cursor-pointer", clicksMode === m.value && view === "clicks" && "font-semibold")}
                >
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          }
        />

        {/* Click | Area sub-toggle */}
        <div className={GROUP}>
          {CLICK_TABS.map(tab => (
            <button key={tab.value} type="button" onClick={() => setView(tab.value)} className={pill(tab.value === "area" && view === "area")}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Scroll */}
        <div className={GROUP}>
          {NON_CLICK_VIEWS.map(v => (
            <button key={v.value} type="button" onClick={() => setView(v.value)} className={pill(view === v.value)}>
              {v.label}
            </button>
          ))}
        </div>

        {/* Attention split — body = 2D cursor heat; caret = mode dropdown */}
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
                  className={cn("cursor-pointer", view === "attention" && attentionMode === m.value && "font-semibold")}
                >
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          }
        />
      </div>

      {/* Right: opacity + device switcher + backdrop picker */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-500 dark:text-neutral-400">Opacity</span>
          <Slider
            value={[opacity]}
            min={0.1}
            max={1}
            step={0.05}
            onValueChange={v => setOpacity(v[0])}
            className="w-24"
          />
        </div>
        <TooltipProvider delayDuration={400}>
          <div className={GROUP}>
            {DEVICES.map(d => (
              <Tooltip key={d.value}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setDevice(d.value)}
                    aria-label={d.label}
                    className={cn(pill(device === d.value), "w-8 justify-center px-0")}
                  >
                    {d.icon}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{d.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
        <SnapshotPicker />
      </div>
    </div>
  );
}
