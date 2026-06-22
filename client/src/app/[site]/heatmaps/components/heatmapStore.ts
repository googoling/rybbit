import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { HeatmapSegment } from "@/api/analytics/endpoints/heatmap";

export type HeatmapView = "clicks" | "attention" | "scroll" | "area";
export type HeatmapClicksMode = "all" | "rage" | "dead" | "first" | "last" | "error";
export type HeatmapAttentionMode = "cursor" | "depth";
export type HeatmapDevice = "" | "Desktop" | "Mobile" | "Tablet";
// "diff" is a viewer mode (converters − everyone), not a server segment value.
export type HeatmapSegmentUI = HeatmapSegment | "diff";

interface HeatmapState {
  hostname: string;
  pathname: string;
  device: HeatmapDevice;
  view: HeatmapView;
  clicksMode: HeatmapClicksMode;
  attentionMode: HeatmapAttentionMode;
  goalId: number | null;
  segment: HeatmapSegmentUI;
  selectedSnapshotAt: string | null;
  opacity: number;
  setPage: (hostname: string, pathname: string) => void;
  setDevice: (device: HeatmapDevice) => void;
  setView: (view: HeatmapView) => void;
  setClicksMode: (mode: HeatmapClicksMode) => void;
  setAttentionMode: (mode: HeatmapAttentionMode) => void;
  setGoalId: (goalId: number | null) => void;
  setSegment: (segment: HeatmapSegmentUI) => void;
  setSelectedSnapshotAt: (at: string | null) => void;
  setOpacity: (opacity: number) => void;
}

// Selection persists across refreshes (page, device, view, sub-modes). Snapshot pick,
// goal, and segment stay session-only. The page selection is validated against the
// current site's pages in the toolbar, so a stale URL falls back to the top page.
export const useHeatmapStore = create<HeatmapState>()(
  persist(
    set => ({
      hostname: "",
      pathname: "",
      device: "Desktop",
      view: "clicks",
      clicksMode: "all",
      attentionMode: "cursor",
      goalId: null,
      segment: "all",
      selectedSnapshotAt: null,
      opacity: 0.7,
      setPage: (hostname, pathname) => set({ hostname, pathname, selectedSnapshotAt: null }),
      setDevice: device => set({ device }),
      setView: view => set({ view }),
      setClicksMode: mode => set({ clicksMode: mode }),
      setAttentionMode: mode => set({ attentionMode: mode }),
      setGoalId: goalId => set({ goalId }),
      setSegment: segment => set({ segment }),
      setSelectedSnapshotAt: at => set({ selectedSnapshotAt: at }),
      setOpacity: opacity => set({ opacity }),
    }),
    {
      name: "rybbit-heatmap-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({
        hostname: state.hostname,
        pathname: state.pathname,
        device: state.device,
        view: state.view,
        clicksMode: state.clicksMode,
        attentionMode: state.attentionMode,
        opacity: state.opacity,
      }),
    }
  )
);
