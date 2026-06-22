"use client";

import { Monitor, Smartphone, Tablet, Camera } from "lucide-react";
import { useGetHeatmapSnapshotsList } from "@/api/analytics/hooks/heatmap/useHeatmap";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useHeatmapStore } from "./heatmapStore";

function deviceIcon(device: string) {
  if (device === "Mobile") return <Smartphone size={14} className="shrink-0" />;
  if (device === "Tablet") return <Tablet size={14} className="shrink-0" />;
  return <Monitor size={14} className="shrink-0" />;
}

function formatDate(capturedAt: string) {
  try {
    const d = new Date(capturedAt.replace(" ", "T") + "Z");
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return capturedAt;
  }
}

export function SnapshotPicker() {
  const { hostname, pathname, selectedSnapshotAt, setSelectedSnapshotAt } = useHeatmapStore();
  const { data: snapshots, isLoading } = useGetHeatmapSnapshotsList(hostname, pathname, !!pathname);

  if (!pathname) return null;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 text-sm text-neutral-700 dark:text-neutral-300 transition-colors cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <Camera size={13} />
          Change backdrop
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Pick a backdrop</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">Loading…</div>
        )}

        {!isLoading && (!snapshots || snapshots.length === 0) && (
          <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
            No backdrops captured yet for this page.
          </div>
        )}

        {!isLoading && snapshots && snapshots.length > 0 && (
          <div className="grid grid-cols-2 gap-3 max-h-[420px] overflow-y-auto pr-1">
            {snapshots.map(s => {
              const isSelected = s.capturedAt === selectedSnapshotAt ||
                (selectedSnapshotAt === null && s === snapshots[0]);
              return (
                <div
                  key={s.capturedAt}
                  className={`rounded-lg border p-3 flex flex-col gap-2 transition-colors ${
                    isSelected
                      ? "border-neutral-900 dark:border-white bg-neutral-50 dark:bg-neutral-800"
                      : "border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500"
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300 font-medium">
                    {deviceIcon(s.capturedDevice)}
                    {s.capturedDevice || "Unknown"}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">
                    {s.pageWidth} × {s.pageHeight}
                  </div>
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">{formatDate(s.capturedAt)}</div>
                  <Button
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    className="mt-1 w-full text-xs h-7"
                    onClick={() => setSelectedSnapshotAt(isSelected ? null : s.capturedAt)}
                  >
                    {isSelected ? "Selected" : "Select"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
