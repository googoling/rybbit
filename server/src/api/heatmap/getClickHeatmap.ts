import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getFilterStatement } from "../analytics/utils/getFilterStatement.js";
import { getTimeStatement, processResults } from "../analytics/utils/utils.js";
import { getGoalSessionFilter } from "./goalSessionFilter.js";

export type GetClickHeatmapResponse = {
  points: { x_percent: number; y_absolute: number; count: number }[];
  totalClicks: number;
  pageHeight: number;
  pageWidth: number;
};

export interface GetClickHeatmapRequest {
  Params: {
    siteId: string;
  };
  Querystring: FilterParams<{
    pathname: string;
    hostname?: string;
    device?: string;
    goalId?: string;
    segment?: string;
    mode?: string;
  }>;
}

type ClickMode = "all" | "first" | "last" | "error";
function parseMode(raw?: string): ClickMode {
  return raw === "first" || raw === "last" || raw === "error" ? raw : "all";
}

export async function getClickHeatmap(req: FastifyRequest<GetClickHeatmapRequest>, res: FastifyReply) {
  const { filters, pathname, hostname, device, goalId, segment } = req.query;
  const site = req.params.siteId;
  const mode = parseMode(req.query.mode);

  if (!pathname) {
    return res.status(400).send({ error: "pathname is required" });
  }

  const timeStatement = getTimeStatement(req.query);
  const filterStatement = getFilterStatement(filters, Number(site), timeStatement);
  const goalFilter = await getGoalSessionFilter({
    siteId: Number(site),
    goalId: goalId ? Number(goalId) : null,
    segment,
    timeStatement,
  });

  // 'error' reads error-marked clicks; everything else reads plain clicks.
  const eventType = mode === "error" ? "error" : "click";
  const whereClause = `
    site_id = {siteId:Int32}
    AND pathname = {pathname:String}
    AND event_type = '${eventType}'
    ${hostname ? "AND hostname = {hostname:String}" : ""}
    ${device ? "AND device_type = {device:String}" : ""}
    ${filterStatement}
    ${goalFilter}
    ${timeStatement}
  `;

  // first/last reduce to one click per session (earliest/latest) before bucketing.
  const sessionPick = mode === "first" ? "argMin" : "argMax";
  const source =
    mode === "first" || mode === "last"
      ? `(
          SELECT
            ${sessionPick}(x_percent, timestamp) AS x_percent,
            ${sessionPick}(y_absolute, timestamp) AS y_absolute
          FROM heatmap_events
          WHERE ${whereClause} AND session_id != ''
          GROUP BY session_id
        )`
      : `heatmap_events WHERE ${whereClause}`;

  // Bucket coordinates to keep the rendered payload small (x to 0.5%, y to 8px).
  const pointsQuery = `
    SELECT
      round(x_percent * 2) / 2 AS x_percent,
      floor(y_absolute / 8) * 8 AS y_absolute,
      count() AS count
    FROM ${source}
    GROUP BY x_percent, y_absolute
  `;

  // Page dimensions are always derived from plain clicks (stable regardless of mode).
  const dimsQuery = `
    SELECT max(page_height) AS pageHeight, any(viewport_width) AS pageWidth
    FROM heatmap_events
    WHERE
      site_id = {siteId:Int32}
      AND pathname = {pathname:String}
      AND event_type = 'click'
      ${hostname ? "AND hostname = {hostname:String}" : ""}
      ${device ? "AND device_type = {device:String}" : ""}
      ${filterStatement}
      ${goalFilter}
      ${timeStatement}
  `;

  try {
    const queryParams = { siteId: Number(site), pathname, ...(hostname ? { hostname } : {}), ...(device ? { device } : {}) };
    const [pointsResult, dimsResult] = await Promise.all([
      clickhouse.query({ query: pointsQuery, format: "JSONEachRow", query_params: queryParams }),
      clickhouse.query({ query: dimsQuery, format: "JSONEachRow", query_params: queryParams }),
    ]);

    const points = await processResults<GetClickHeatmapResponse["points"][number]>(pointsResult);
    const dims = await processResults<{ pageHeight: number; pageWidth: number }>(dimsResult);
    const totalClicks = points.reduce((s, p) => s + Number(p.count), 0);

    return res.send({
      data: {
        points,
        totalClicks,
        pageHeight: dims[0]?.pageHeight ?? 0,
        pageWidth: dims[0]?.pageWidth ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching click heatmap:", error);
    return res.status(500).send({ error: "Failed to fetch click heatmap" });
  }
}
