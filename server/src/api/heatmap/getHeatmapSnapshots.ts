import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { processResults } from "../analytics/utils/utils.js";

export interface SnapshotMeta {
  capturedAt: string;
  capturedDevice: string;
  pageWidth: number;
  pageHeight: number;
}

export interface GetHeatmapSnapshotsRequest {
  Params: { siteId: string };
  Querystring: {
    pathname: string;
    hostname?: string;
  };
}

// List of available backdrop snapshots (metadata only, no blob) for a page. Newest first.
export async function getHeatmapSnapshots(req: FastifyRequest<GetHeatmapSnapshotsRequest>, res: FastifyReply) {
  const { pathname, hostname } = req.query;
  const site = req.params.siteId;

  if (!pathname) {
    return res.status(400).send({ error: "pathname is required" });
  }

  try {
    const result = await clickhouse.query({
      query: `
        SELECT
          toString(captured_at) AS capturedAt,
          device_type AS capturedDevice,
          page_width AS pageWidth,
          page_height AS pageHeight
        FROM heatmap_snapshots
        WHERE site_id = {siteId:Int32}
          AND pathname = {pathname:String}
          ${hostname ? "AND hostname = {hostname:String}" : ""}
        ORDER BY captured_at DESC
        LIMIT 20
      `,
      format: "JSONEachRow",
      query_params: { siteId: Number(site), pathname, ...(hostname ? { hostname } : {}) },
    });

    const rows = await processResults<{
      capturedAt: string;
      capturedDevice: string;
      pageWidth: number;
      pageHeight: number;
    }>(result);

    const snapshots: SnapshotMeta[] = rows.map(r => ({
      capturedAt: r.capturedAt,
      capturedDevice: r.capturedDevice,
      pageWidth: Number(r.pageWidth),
      pageHeight: Number(r.pageHeight),
    }));

    return res.send({ data: snapshots });
  } catch (error) {
    console.error("Error listing heatmap snapshots:", error);
    return res.status(500).send({ error: "Failed to list snapshots" });
  }
}
