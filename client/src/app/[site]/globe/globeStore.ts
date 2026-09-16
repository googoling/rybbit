import { create } from "zustand";
import { MapView } from "./components/ModeSelector";
import { IS_CLOUD } from "../../../lib/const";
import { DEFAULT_MAP_STYLE_ID } from "../../../lib/mapStyles";

interface GlobeStore {
  mapView: MapView;
  setMapView: (view: MapView) => void;
  mapMode: "3D" | "2D";
  setMapMode: (mode: "3D" | "2D") => void;
  mapStyle: string;
  setMapStyle: (style: string) => void;
  timelineStyle: string;
  setTimelineStyle: (style: string) => void;
}

export const useGlobeStore = create<GlobeStore>(set => ({
  mapView: "timeline",
  setMapView: view => set({ mapView: view }),
  mapMode: IS_CLOUD ? "3D" : "2D",
  setMapMode: mode => set({ mapMode: mode }),
  mapStyle: DEFAULT_MAP_STYLE_ID,
  setMapStyle: style => set({ mapStyle: style }),
  timelineStyle: DEFAULT_MAP_STYLE_ID,
  setTimelineStyle: style => set({ timelineStyle: style }),
}));
