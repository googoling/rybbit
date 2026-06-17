import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getFilterStatement } from "../analytics/utils/getFilterStatement.js";
import { getTimeStatement, processResults } from "../analytics/utils/utils.js";
import { getGoalSessionFilter } from "./goalSessionFilter.js";

export type GetAttentionMapResponse = {
  points: { x_percent: number; y_absolute: number; count: number }[];
  totalSamples: number;
  sessions: number;
  pageHeight: number;
  pageWidth: number;
};

export interface GetAttentionMapRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{
    pathname: string;
    hostname?: string;
    device?: string;
    goalId?: string;
    segment?: string;
  }>;
}

// Mouse-movement (attention) density — same shape as clicks, over dwell-weighted 'move' samples.
export async function getAttentionMap(req: FastifyRequest<GetAttentionMapRequest>, res: FastifyReply) {
  const { filters, pathname, hostname, device, goalId, segment } = req.query;
  const site = req.params.siteId;

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

  const whereClause = `
    site_id = {siteId:Int32}
    AND pathname = {pathname:String}
    AND event_type = 'move'
    ${hostname ? "AND hostname = {hostname:String}" : ""}
    ${device ? "AND device_type = {device:String}" : ""}
    ${filterStatement}
    ${goalFilter}
    ${timeStatement}
  `;

  const pointsQuery = `
    SELECT
      round(x_percent * 2) / 2 AS x_percent,
      floor(y_absolute / 8) * 8 AS y_absolute,
      count() AS count
    FROM heatmap_events
    WHERE ${whereClause}
    GROUP BY x_percent, y_absolute
  `;

  const totalsQuery = `
    SELECT
      count() AS totalSamples,
      uniqExact(session_id) AS sessions,
      max(page_height) AS pageHeight,
      any(viewport_width) AS pageWidth
    FROM heatmap_events
    WHERE ${whereClause}
  `;

  try {
    const queryParams = { siteId: Number(site), pathname, ...(hostname ? { hostname } : {}), ...(device ? { device } : {}) };
    const [pointsResult, totalsResult] = await Promise.all([
      clickhouse.query({ query: pointsQuery, format: "JSONEachRow", query_params: queryParams }),
      clickhouse.query({ query: totalsQuery, format: "JSONEachRow", query_params: queryParams }),
    ]);

    const points = await processResults<GetAttentionMapResponse["points"][number]>(pointsResult);
    const totals = await processResults<{
      totalSamples: number;
      sessions: number;
      pageHeight: number;
      pageWidth: number;
    }>(totalsResult);

    return res.send({
      data: {
        points,
        totalSamples: totals[0]?.totalSamples ?? 0,
        sessions: totals[0]?.sessions ?? 0,
        pageHeight: totals[0]?.pageHeight ?? 0,
        pageWidth: totals[0]?.pageWidth ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching attention map:", error);
    return res.status(500).send({ error: "Failed to fetch attention map" });
  }
}
