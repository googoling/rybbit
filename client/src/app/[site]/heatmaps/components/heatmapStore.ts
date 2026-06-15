import { create } from "zustand";
import { HeatmapSegment } from "@/api/analytics/endpoints/heatmap";

export type HeatmapView = "clicks" | "attention" | "scroll" | "insights";
export type HeatmapDevice = "" | "Desktop" | "Mobile" | "Tablet";
// "diff" is a viewer mode (converters − everyone), not a server segment value.
export type HeatmapSegmentUI = HeatmapSegment | "diff";

interface HeatmapState {
  pathname: string;
  device: HeatmapDevice;
  view: HeatmapView;
  goalId: number | null;
  segment: HeatmapSegmentUI;
  setPathname: (pathname: string) => void;
  setDevice: (device: HeatmapDevice) => void;
  setView: (view: HeatmapView) => void;
  setGoalId: (goalId: number | null) => void;
  setSegment: (segment: HeatmapSegmentUI) => void;
}

export const useHeatmapStore = create<HeatmapState>(set => ({
  pathname: "",
  device: "Desktop",
  view: "clicks",
  goalId: null,
  segment: "all",
  setPathname: pathname => set({ pathname }),
  setDevice: device => set({ device }),
  setView: view => set({ view }),
  setGoalId: goalId => set({ goalId }),
  setSegment: segment => set({ segment }),
}));
