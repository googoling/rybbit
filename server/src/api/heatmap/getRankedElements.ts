import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getFilterStatement } from "../analytics/utils/getFilterStatement.js";
import { getTimeStatement, processResults } from "../analytics/utils/utils.js";
import { getGoalSessionFilter } from "./goalSessionFilter.js";

export type RankedElement = {
  element_selector: string;
  element_text: string;
  clicks: number;
  percentage: number;
};

export interface GetRankedElementsRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{
    pathname: string;
    device?: string;
    goalId?: string;
    segment?: string;
    limit?: string;
  }>;
}

const MAX_LIMIT = 100;

// Most-clicked elements on a page, by CSS selector.
export async function getRankedElements(req: FastifyRequest<GetRankedElementsRequest>, res: FastifyReply) {
  const { filters, pathname, device, goalId, segment, limit } = req.query;
  const site = req.params.siteId;

  if (!pathname) {
    return res.status(400).send({ error: "pathname is required" });
  }

  const parsedLimit = Math.min(Math.max(Number(limit) || 20, 1), MAX_LIMIT);
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
    AND event_type = 'click'
    AND element_selector != ''
    ${device ? "AND device_type = {device:String}" : ""}
    ${filterStatement}
    ${goalFilter}
    ${timeStatement}
  `;

  const elementsQuery = `
    SELECT
      element_selector,
      any(element_text) AS element_text,
      count() AS clicks
    FROM heatmap_events
    WHERE ${whereClause}
    GROUP BY element_selector
    ORDER BY clicks DESC
    LIMIT {limit:Int32}
  `;

  const totalQuery = `
    SELECT count() AS total
    FROM heatmap_events
    WHERE ${whereClause}
  `;

  try {
    const queryParams = { siteId: Number(site), pathname, limit: parsedLimit, ...(device ? { device } : {}) };
    const [elementsResult, totalResult] = await Promise.all([
      clickhouse.query({ query: elementsQuery, format: "JSONEachRow", query_params: queryParams }),
      clickhouse.query({ query: totalQuery, format: "JSONEachRow", query_params: queryParams }),
    ]);

    const elements = await processResults<{ element_selector: string; element_text: string; clicks: number }>(
      elementsResult
    );
    const totals = await processResults<{ total: number }>(totalResult);
    const total = totals[0]?.total ?? 0;

    const ranked: RankedElement[] = elements.map(e => ({
      element_selector: e.element_selector,
      element_text: e.element_text,
      clicks: Number(e.clicks),
      percentage: total > 0 ? Math.round((Number(e.clicks) / total) * 1000) / 10 : 0,
    }));

    return res.send({ data: ranked });
  } catch (error) {
    console.error("Error fetching ranked elements:", error);
    return res.status(500).send({ error: "Failed to fetch ranked elements" });
  }
}
