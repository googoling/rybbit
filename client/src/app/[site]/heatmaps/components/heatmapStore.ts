import { create } from "zustand";
import { HeatmapSegment } from "@/api/analytics/endpoints/heatmap";

export type HeatmapView = "clicks" | "attention" | "scroll" | "area";
export type HeatmapClicksMode = "all" | "rage" | "dead";
export type HeatmapDevice = "" | "Desktop" | "Mobile" | "Tablet";
// "diff" is a viewer mode (converters − everyone), not a server segment value.
export type HeatmapSegmentUI = HeatmapSegment | "diff";

interface HeatmapState {
  hostname: string;
  pathname: string;
  device: HeatmapDevice;
  view: HeatmapView;
  clicksMode: HeatmapClicksMode;
  goalId: number | null;
  segment: HeatmapSegmentUI;
  selectedSnapshotAt: string | null;
  setPage: (hostname: string, pathname: string) => void;
  setDevice: (device: HeatmapDevice) => void;
  setView: (view: HeatmapView) => void;
  setClicksMode: (mode: HeatmapClicksMode) => void;
  setGoalId: (goalId: number | null) => void;
  setSegment: (segment: HeatmapSegmentUI) => void;
  setSelectedSnapshotAt: (at: string | null) => void;
}

export const useHeatmapStore = create<HeatmapState>(set => ({
  hostname: "",
  pathname: "",
  device: "Desktop",
  view: "clicks",
  clicksMode: "all",
  goalId: null,
  segment: "all",
  selectedSnapshotAt: null,
  setPage: (hostname, pathname) => set({ hostname, pathname, selectedSnapshotAt: null }),
  setDevice: device => set({ device }),
  setView: view => set({ view }),
  setClicksMode: mode => set({ clicksMode: mode }),
  setGoalId: goalId => set({ goalId }),
  setSegment: segment => set({ segment }),
  setSelectedSnapshotAt: at => set({ selectedSnapshotAt: at }),
}));
