"use client";

import { useSetPageTitle } from "@/hooks/useSetPageTitle";
import { HEATMAPS_PAGE_FILTERS } from "@/lib/filterGroups";
import { SubHeader } from "../components/SubHeader/SubHeader";
import { HeatmapPageList } from "./components/HeatmapPageList";
import { HeatmapToolbar } from "./components/HeatmapToolbar";
import { HeatmapViewer } from "./components/HeatmapViewer";

export default function HeatmapsPage() {
  useSetPageTitle("Heatmaps");

  return (
    <div className="p-4">
      <SubHeader availableFilters={HEATMAPS_PAGE_FILTERS} />
      <div className="mt-3 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-3 items-start">
        <HeatmapPageList />
        <div className="flex flex-col gap-3 min-w-0">
          <HeatmapToolbar />
          <HeatmapViewer />
        </div>
      </div>
    </div>
  );
}
