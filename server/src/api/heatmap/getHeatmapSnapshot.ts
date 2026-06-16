import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { processResults } from "../analytics/utils/utils.js";

export type GetHeatmapSnapshotResponse = {
  events: any[]; // rrweb Meta + FullSnapshot events for the frozen backdrop
  pageWidth: number;
  pageHeight: number;
  capturedAt: string | null;
  capturedDevice: string | null;
};

export interface GetHeatmapSnapshotRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{
    pathname: string;
    hostname?: string;
    device?: string;
    capturedAt?: string;
  }>;
}

// Latest frozen DOM snapshot for a page/device — the heatmap backdrop. Tiny + cached hard.
export async function getHeatmapSnapshot(req: FastifyRequest<GetHeatmapSnapshotRequest>, res: FastifyReply) {
  const { pathname, hostname, device, capturedAt } = req.query;
  const site = req.params.siteId;

  if (!pathname) {
    return res.status(400).send({ error: "pathname is required" });
  }

  const baseParams = { siteId: Number(site), pathname, ...(hostname ? { hostname } : {}) };
  const baseParamsNoHost = { siteId: Number(site), pathname };

  type Row = { snapshot: string; pageWidth: number; pageHeight: number; capturedAt: string; capturedDevice: string };

  // If a specific snapshot timestamp is requested, fetch it directly (no fallback chain needed).
  if (capturedAt) {
    try {
      const result = await clickhouse.query({
        query: `
          SELECT snapshot, page_width AS pageWidth, page_height AS pageHeight, toString(captured_at) AS capturedAt, device_type AS capturedDevice
          FROM heatmap_snapshots
          WHERE site_id = {siteId:Int32}
            AND pathname = {pathname:String}
            AND captured_at = {capturedAt:String}
          LIMIT 1
        `,
        format: "JSONEachRow",
        query_params: { siteId: Number(site), pathname, capturedAt },
      });
      const rows = await processResults<Row>(result);
      const row = rows[0];
      let events: any[] = [];
      if (row?.snapshot) {
        try { events = JSON.parse(row.snapshot); } catch {}
      }
      return res.send({
        data: {
          events,
          pageWidth: row?.pageWidth ?? 0,
          pageHeight: row?.pageHeight ?? 0,
          capturedAt: row?.capturedAt ?? null,
          capturedDevice: row?.capturedDevice ?? null,
        },
      });
    } catch (error) {
      console.error("Error fetching heatmap snapshot by capturedAt:", error);
      return res.status(500).send({ error: "Failed to fetch snapshot" });
    }
  }

  const buildQuery = (withHostname: boolean, deviceFilter: boolean) => `
    SELECT snapshot, page_width AS pageWidth, page_height AS pageHeight, toString(captured_at) AS capturedAt, device_type AS capturedDevice
    FROM heatmap_snapshots
    WHERE site_id = {siteId:Int32}
      AND pathname = {pathname:String}
      ${withHostname && hostname ? "AND hostname = {hostname:String}" : ""}
      ${deviceFilter ? "AND device_type = {device:String}" : ""}
    ORDER BY captured_at DESC
    LIMIT 1
  `;

  try {
    const tryQuery = async (withHostname: boolean, deviceFilter?: string) => {
      const params = withHostname ? baseParams : baseParamsNoHost;
      const result = await clickhouse.query({
        query: buildQuery(withHostname, !!deviceFilter),
        format: "JSONEachRow",
        query_params: { ...params, ...(deviceFilter ? { device: deviceFilter } : {}) },
      });
      return processResults<Row>(result);
    };

    // 1. Exact match: hostname + device
    // 2. Any device for this hostname
    // 3. Any device, any hostname (catches old empty-hostname captures)
    let rows = device ? await tryQuery(true, device) : await tryQuery(true);
    if (!rows.length && device) rows = await tryQuery(true);
    if (!rows.length) rows = await tryQuery(false, device);
    if (!rows.length && device) rows = await tryQuery(false);

    const row = rows[0];
    let events: any[] = [];
    if (row?.snapshot) {
      try {
        events = JSON.parse(row.snapshot);
      } catch (parseError) {
        console.error("Error parsing heatmap snapshot:", parseError);
      }
    }

    return res.send({
      data: {
        events,
        pageWidth: row?.pageWidth ?? 0,
        pageHeight: row?.pageHeight ?? 0,
        capturedAt: row?.capturedAt ?? null,
        capturedDevice: row?.capturedDevice ?? null,
      },
    });
  } catch (error) {
    console.error("Error fetching heatmap snapshot:", error);
    return res.status(500).send({ error: "Failed to fetch heatmap snapshot" });
  }
}
