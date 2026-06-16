import { useQuery } from "@tanstack/react-query";
import { buildApiParams } from "@/api/utils";
import { useStore } from "@/lib/store";
import {
  fetchAttentionMap,
  fetchClickHeatmap,
  fetchClickInsights,
  fetchHeatmapPages,
  fetchHeatmapSnapshot,
  fetchHeatmapSnapshotsList,
  fetchRankedElements,
  fetchScrollMap,
  HeatmapSegment,
} from "@/api/analytics/endpoints/heatmap";

interface ViewArgs {
  hostname?: string;
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

export function useGetClickHeatmap({ hostname, pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-clicks", site, time, filters, hostname, pathname, device, goalId, segment],
    queryFn: () => fetchClickHeatmap(site, { ...params, hostname, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetAttentionMap({ hostname, pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-attention", site, time, filters, hostname, pathname, device, goalId, segment],
    queryFn: () => fetchAttentionMap(site, { ...params, hostname, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetScrollMap({ hostname, pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-scroll", site, time, filters, hostname, pathname, device, goalId, segment],
    queryFn: () => fetchScrollMap(site, { ...params, hostname, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetRankedElements({ hostname, pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-elements", site, time, filters, hostname, pathname, device, goalId, segment],
    queryFn: () => fetchRankedElements(site, { ...params, hostname, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetClickInsights({ hostname, pathname, device, goalId, segment, enabled = true }: ViewArgs) {
  const { time, site, filters } = useStore();
  const params = buildApiParams(time, { filters });
  return useQuery({
    queryKey: ["heatmap-insights", site, time, filters, hostname, pathname, device, goalId, segment],
    queryFn: () => fetchClickInsights(site, { ...params, hostname, pathname, device, goalId, segment }),
    enabled: !!site && !!pathname && enabled,
    staleTime: Infinity,
  });
}

export function useGetHeatmapSnapshot(
  hostname: string,
  pathname: string,
  device?: string,
  enabled = true,
  capturedAt?: string
) {
  const { site } = useStore();
  return useQuery({
    queryKey: ["heatmap-snapshot", site, hostname, pathname, device, capturedAt],
    queryFn: () => fetchHeatmapSnapshot(site, { hostname, pathname, device, capturedAt }),
    enabled: !!site && !!pathname && enabled,
    staleTime: 0,
  });
}

export function useGetHeatmapSnapshotsList(hostname: string, pathname: string, enabled = true) {
  const { site } = useStore();
  return useQuery({
    queryKey: ["heatmap-snapshots-list", site, hostname, pathname],
    queryFn: () => fetchHeatmapSnapshotsList(site, { hostname, pathname }),
    enabled: !!site && !!pathname && enabled,
    staleTime: 60_000,
  });
}
