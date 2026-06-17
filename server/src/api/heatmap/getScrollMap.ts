import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getFilterStatement } from "../analytics/utils/getFilterStatement.js";
import { getTimeStatement, processResults } from "../analytics/utils/utils.js";
import { getGoalSessionFilter } from "./goalSessionFilter.js";
import { computeScrollBuckets } from "./scrollMath.js";

export type ScrollMapBucket = { depth: number; reach: number };

export type GetScrollMapResponse = {
  buckets: ScrollMapBucket[];
  totalSessions: number;
  averageScrollDepth: number;
  pageHeight: number;
  pageWidth: number;
  foldPercent: number;
};

export interface GetScrollMapRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{
    pathname: string;
    hostname?: string;
    device?: string;
    goalId?: string;
    segment?: string;
  }>;
}

// Scroll-depth reach: for each 5% depth band, the share of sessions that scrolled that far.
export async function getScrollMap(req: FastifyRequest<GetScrollMapRequest>, res: FastifyReply) {
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
    ${hostname ? "AND hostname = {hostname:String}" : ""}
    ${device ? "AND device_type = {device:String}" : ""}
    ${filterStatement}
    ${goalFilter}
    ${timeStatement}
  `;

  // Per-session deepest scroll, bucketed to 5%; reach is computed cumulatively below.
  const histogramQuery = `
    SELECT floor(d / 5) * 5 AS depth, count() AS sessions
    FROM (
      SELECT session_id, max(scroll_depth) AS d
      FROM heatmap_events
      WHERE ${whereClause}
      GROUP BY session_id
    )
    GROUP BY depth
    ORDER BY depth
  `;

  const pageQuery = `
    SELECT
      max(page_height) AS pageHeight,
      any(viewport_width) AS pageWidth,
      round(avg(viewport_height) / nullif(max(page_height), 0) * 100) AS foldPercent
    FROM heatmap_events
    WHERE ${whereClause}
  `;

  try {
    const queryParams = { siteId: Number(site), pathname, ...(hostname ? { hostname } : {}), ...(device ? { device } : {}) };
    const [histResult, pageResult] = await Promise.all([
      clickhouse.query({ query: histogramQuery, format: "JSONEachRow", query_params: queryParams }),
      clickhouse.query({ query: pageQuery, format: "JSONEachRow", query_params: queryParams }),
    ]);

    const hist = await processResults<{ depth: number; sessions: number }>(histResult);
    const page = await processResults<{ pageHeight: number; pageWidth: number; foldPercent: number }>(pageResult);

    const { buckets, totalSessions, averageScrollDepth } = computeScrollBuckets(hist);

    return res.send({
      data: {
        buckets,
        totalSessions,
        averageScrollDepth,
        pageHeight: page[0]?.pageHeight ?? 0,
        pageWidth: page[0]?.pageWidth ?? 0,
        foldPercent: page[0]?.foldPercent ?? 0,
      },
    });
  } catch (error) {
    console.error("Error fetching scroll map:", error);
    return res.status(500).send({ error: "Failed to fetch scroll map" });
  }
}
