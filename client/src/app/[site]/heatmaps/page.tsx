"use client";

import { useSetPageTitle } from "@/hooks/useSetPageTitle";
import { HEATMAPS_PAGE_FILTERS } from "@/lib/filterGroups";
import { SubHeader } from "../components/SubHeader/SubHeader";
import { HeatmapToolbar } from "./components/HeatmapToolbar";
import { HeatmapViewer } from "./components/HeatmapViewer";

export default function HeatmapsPage() {
  useSetPageTitle("Heatmaps");

  return (
    <div className="p-2 md:p-4 max-w-[1400px] mx-auto space-y-3">
      <SubHeader availableFilters={HEATMAPS_PAGE_FILTERS} />
      <HeatmapToolbar />
      <HeatmapViewer />
    </div>
  );
}
