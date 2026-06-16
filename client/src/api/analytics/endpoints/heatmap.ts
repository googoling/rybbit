import { authedFetch } from "../../utils";
import { CommonApiParams, toQueryParams } from "./types";

// Bucketed point for the heat canvas
export interface HeatmapPoint {
  x_percent: number;
  y_absolute: number;
  count: number;
}

export interface HeatmapPointsResponse {
  points: HeatmapPoint[];
  totalClicks: number;
  pageHeight: number;
  pageWidth: number;
}

export interface RankedElement {
  element_selector: string;
  element_text: string;
  clicks: number;
  percentage: number;
  avg_x?: number;
  avg_y?: number;
}

export type RankedElementsResponse = RankedElement[];

export interface ScrollMapBucket {
  depth: number;
  reach: number;
}

export interface ScrollMapResponse {
  buckets: ScrollMapBucket[];
  totalSessions: number;
  averageScrollDepth: number;
  pageHeight: number;
  pageWidth: number;
  foldPercent: number;
}

export interface AttentionMapResponse {
  points: HeatmapPoint[];
  totalSamples: number;
  sessions: number;
  pageHeight: number;
  pageWidth: number;
}

export interface InsightElement {
  element_selector: string;
  element_text: string;
  count: number;
}

export interface ClickInsightsResponse {
  rage: { points: HeatmapPoint[]; total: number };
  dead: { points: HeatmapPoint[]; total: number };
  topRageElements: InsightElement[];
  topDeadElements: InsightElement[];
}

// Frozen backdrop snapshot (rrweb Meta + FullSnapshot events) for one page/device.
export interface HeatmapSnapshotResponse {
  events: any[];
  pageWidth: number;
  pageHeight: number;
  capturedAt: string | null;
  capturedDevice: string | null;
}

// Metadata for listing available snapshots (no blob).
export interface SnapshotMeta {
  capturedAt: string;
  capturedDevice: string;
  pageWidth: number;
  pageHeight: number;
}

export interface HeatmapPageItem {
  hostname: string;
  pathname: string;
  events: number;
  sessions: number;
}

export type HeatmapSegment = "all" | "converters" | "non_converters";

// Page + device + conversion segmentation on top of the shared time/filter params.
export interface HeatmapParams extends CommonApiParams {
  hostname?: string;
  pathname: string;
  device?: string;
  goalId?: number | null;
  segment?: HeatmapSegment;
}

function heatmapQuery(params: HeatmapParams) {
  return {
    ...toQueryParams(params),
    hostname: params.hostname,
    pathname: params.pathname,
    device: params.device,
    goalId: params.goalId ?? undefined,
    segment: params.segment,
  };
}

export async function fetchHeatmapPages(
  site: string | number,
  params: CommonApiParams & { device?: string }
): Promise<HeatmapPageItem[]> {
  const queryParams = { ...toQueryParams(params), device: params.device };
  const response = await authedFetch<{ data: HeatmapPageItem[] }>(`/sites/${site}/heatmap/pages`, queryParams);
  return response.data;
}

export async function fetchClickHeatmap(site: string | number, params: HeatmapParams): Promise<HeatmapPointsResponse> {
  const response = await authedFetch<{ data: HeatmapPointsResponse }>(
    `/sites/${site}/heatmap/clicks`,
    heatmapQuery(params)
  );
  return response.data;
}

export async function fetchAttentionMap(site: string | number, params: HeatmapParams): Promise<AttentionMapResponse> {
  const response = await authedFetch<{ data: AttentionMapResponse }>(
    `/sites/${site}/heatmap/attention`,
    heatmapQuery(params)
  );
  return response.data;
}

export async function fetchScrollMap(site: string | number, params: HeatmapParams): Promise<ScrollMapResponse> {
  const response = await authedFetch<{ data: ScrollMapResponse }>(
    `/sites/${site}/heatmap/scroll`,
    heatmapQuery(params)
  );
  return response.data;
}

export async function fetchRankedElements(
  site: string | number,
  params: HeatmapParams
): Promise<RankedElementsResponse> {
  const response = await authedFetch<{ data: RankedElementsResponse }>(
    `/sites/${site}/heatmap/elements`,
    heatmapQuery(params)
  );
  return response.data;
}

export async function fetchClickInsights(site: string | number, params: HeatmapParams): Promise<ClickInsightsResponse> {
  const response = await authedFetch<{ data: ClickInsightsResponse }>(
    `/sites/${site}/heatmap/insights`,
    heatmapQuery(params)
  );
  return response.data;
}

export async function fetchHeatmapSnapshot(
  site: string | number,
  params: { hostname?: string; pathname: string; device?: string; capturedAt?: string }
): Promise<HeatmapSnapshotResponse> {
  const response = await authedFetch<{ data: HeatmapSnapshotResponse }>(`/sites/${site}/heatmap/snapshot`, {
    hostname: params.hostname,
    pathname: params.pathname,
    device: params.device,
    capturedAt: params.capturedAt,
  });
  return response.data;
}

export async function fetchHeatmapSnapshotsList(
  site: string | number,
  params: { hostname?: string; pathname: string }
): Promise<SnapshotMeta[]> {
  const response = await authedFetch<{ data: SnapshotMeta[] }>(`/sites/${site}/heatmap/snapshots`, {
    hostname: params.hostname,
    pathname: params.pathname,
  });
  return response.data;
}
