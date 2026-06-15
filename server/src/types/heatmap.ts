export interface HeatmapEventInput {
  type: "click" | "scroll" | "rage" | "dead" | "move";
  pathname: string;
  x_percent: number;
  y_absolute: number;
  viewport_width: number;
  viewport_height: number;
  page_width: number;
  page_height: number;
  scroll_depth: number;
  element_selector?: string;
  element_text?: string;
  timestamp: number;
}

export interface RecordHeatmapRequest {
  userId: string;
  metadata: {
    hostname: string;
    language?: string;
  };
  events: HeatmapEventInput[];
}

// Queue payload carries the resolved session/user identity plus the request
// context the queue needs for geo/UA enrichment at flush time.
export interface HeatmapQueueEvent extends HeatmapEventInput {
  siteId: number;
  sessionId: string;
  userId: string;
  identifiedUserId: string;
  hostname: string;
  userAgent: string;
  ipAddress: string;
  storeIp: boolean;
}

// Frozen backdrop snapshot (rrweb Meta + FullSnapshot events) for one page/device.
export interface RecordHeatmapSnapshotRequest {
  pathname: string;
  page_width: number;
  page_height: number;
  viewport_width: number;
  viewport_height: number;
  events: { type: number | string; data: any; timestamp: number }[];
}
