"use client";

import { useExtracted } from "next-intl";

interface HeatmapLegendProps {
  mode: "heat" | "diff" | "scroll";
}

// Compact color key for the active overlay.
export function HeatmapLegend({ mode }: HeatmapLegendProps) {
  const t = useExtracted();

  if (mode === "diff") {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>{t("Non-converters")}</span>
        <div
          className="h-2 w-32 rounded"
          style={{ background: "linear-gradient(to right, rgb(37,99,235), rgba(0,0,0,0.05), rgb(220,38,38))" }}
        />
        <span>{t("Converters")}</span>
      </div>
    );
  }

  const label = mode === "scroll" ? t("Fewer reach") : t("Low");
  const labelHigh = mode === "scroll" ? t("More reach") : t("High");

  return (
    <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
      <span>{label}</span>
      <div
        className="h-2 w-32 rounded"
        style={{
          background: "linear-gradient(to right, rgba(0,0,255,0.7), rgb(0,255,255), rgb(0,255,0), rgb(255,255,0), rgb(255,0,0))",
        }}
      />
      <span>{labelHigh}</span>
    </div>
  );
}
