import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { processResults } from "../analytics/utils/utils.js";

export type GetHeatmapSnapshotResponse = {
  events: any[]; // rrweb Meta + FullSnapshot events for the frozen backdrop
  pageWidth: number;
  pageHeight: number;
  capturedAt: string | null;
};

export interface GetHeatmapSnapshotRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{
    pathname: string;
    device?: string;
  }>;
}

// Latest frozen DOM snapshot for a page/device — the heatmap backdrop. Tiny + cached hard.
export async function getHeatmapSnapshot(req: FastifyRequest<GetHeatmapSnapshotRequest>, res: FastifyReply) {
  const { pathname, device } = req.query;
  const site = req.params.siteId;

  if (!pathname) {
    return res.status(400).send({ error: "pathname is required" });
  }

  // ReplacingMergeTree: ORDER BY captured_at DESC LIMIT 1 returns the newest even pre-merge.
  const query = `
    SELECT snapshot, page_width AS pageWidth, page_height AS pageHeight, toString(captured_at) AS capturedAt
    FROM heatmap_snapshots
    WHERE site_id = {siteId:Int32}
      AND pathname = {pathname:String}
      ${device ? "AND device_type = {device:String}" : ""}
    ORDER BY captured_at DESC
    LIMIT 1
  `;

  try {
    const result = await clickhouse.query({
      query,
      format: "JSONEachRow",
      query_params: { siteId: Number(site), pathname, ...(device ? { device } : {}) },
    });

    const rows = await processResults<{
      snapshot: string;
      pageWidth: number;
      pageHeight: number;
      capturedAt: string;
    }>(result);

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
      },
    });
  } catch (error) {
    console.error("Error fetching heatmap snapshot:", error);
    return res.status(500).send({ error: "Failed to fetch heatmap snapshot" });
  }
}
