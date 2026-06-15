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
    device?: string;
    goalId?: string;
    segment?: string;
  }>;
}

export async function getClickHeatmap(req: FastifyRequest<GetClickHeatmapRequest>, res: FastifyReply) {
  const { filters, pathname, device, goalId, segment } = req.query;
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

  // Bucket coordinates to keep the rendered payload small (x to 0.5%, y to 8px).
  const pointsQuery = `
    SELECT
      round(x_percent * 2) / 2 AS x_percent,
      floor(y_absolute / 8) * 8 AS y_absolute,
      count() AS count
    FROM heatmap_events
    WHERE
      site_id = {siteId:Int32}
      AND pathname = {pathname:String}
      AND event_type = 'click'
      ${device ? "AND device_type = {device:String}" : ""}
      ${filterStatement}
      ${goalFilter}
      ${timeStatement}
    GROUP BY x_percent, y_absolute
  `;

  const totalsQuery = `
    SELECT
      count() AS totalClicks,
      max(page_height) AS pageHeight,
      any(page_width) AS pageWidth
    FROM heatmap_events
    WHERE
      site_id = {siteId:Int32}
      AND pathname = {pathname:String}
      AND event_type = 'click'
      ${device ? "AND device_type = {device:String}" : ""}
      ${filterStatement}
      ${goalFilter}
      ${timeStatement}
  `;

  try {
    const [pointsResult, totalsResult] = await Promise.all([
      clickhouse.query({
        query: pointsQuery,
        format: "JSONEachRow",
        query_params: { siteId: Number(site), pathname, ...(device ? { device } : {}) },
      }),
      clickhouse.query({
        query: totalsQuery,
        format: "JSONEachRow",
        query_params: { siteId: Number(site), pathname, ...(device ? { device } : {}) },
      }),
    ]);

    const points = await processResults<GetClickHeatmapResponse["points"][number]>(pointsResult);
    const totals = await processResults<{ totalClicks: number; pageHeight: number; pageWidth: number }>(totalsResult);

    return res.send({
      data: {
        points,
        totalClicks: totals[0]?.totalClicks ?? 0,
        pageHeight: totals[0]?.pageHeight ?? 0,
        pageWidth: totals[0]?.pageWidth ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching click heatmap:", error);
    return res.status(500).send({ error: "Failed to fetch click heatmap" });
  }
}
