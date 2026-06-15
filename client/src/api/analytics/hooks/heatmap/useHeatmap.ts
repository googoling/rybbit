import { useQuery } from "@tanstack/react-query";
import { buildApiParams } from "@/api/utils";
import { useStore } from "@/lib/store";
import {
  fetchAttentionMap,
  fetchClickHeatmap,
  fetchClickInsights,
  fetchHeatmapPages,
  fetchHeatmapSnapshot,
  fetchRankedElements,
  fetchScrollMap,
  HeatmapSegment,
} from "@/api/analytics/endpoints/heatmap";

interface ViewArgs {
  pathname: string;
  device?: string;
  goalId?: number | null;
  segment?: HeatmapSegment;
  enabled?: boolean;
}

export function useGetHeatmapPages(device?: string) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-pages", site, time, filters, device],
    queryFn: () => fetchHeatmapPages(site, { ...params, device }),
    enabled: !!site,
    staleTime: 60_000,
  });
}

export function useGetClickHeatmap({ pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-clicks", site, time, filters, pathname, device, goalId, segment],
    queryFn: () => fetchClickHeatmap(site, { ...params, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetAttentionMap({ pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-attention", site, time, filters, pathname, device, goalId, segment],
    queryFn: () => fetchAttentionMap(site, { ...params, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetScrollMap({ pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-scroll", site, time, filters, pathname, device, goalId, segment],
    queryFn: () => fetchScrollMap(site, { ...params, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetRankedElements({ pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-elements", site, time, filters, pathname, device, goalId, segment],
    queryFn: () => fetchRankedElements(site, { ...params, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetClickInsights({ pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-insights", site, time, filters, pathname, device, goalId, segment],
    queryFn: () => fetchClickInsights(site, { ...params, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetHeatmapSnapshot(pathname: string, device?: string, enabled = true) {
  const { site } = useStore();
  return useQuery({
    queryKey: ["heatmap-snapshot", site, pathname, device],
    queryFn: () => fetchHeatmapSnapshot(site, { pathname, device }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}
