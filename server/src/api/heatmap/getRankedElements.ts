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
  avg_x: number;
  avg_y: number;
};

export interface GetRankedElementsRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{
    pathname: string;
    hostname?: string;
    device?: string;
    goalId?: string;
    segment?: string;
    limit?: string;
    mode?: string;
  }>;
}

const MAX_LIMIT = 100;

type ClickMode = "all" | "first" | "last" | "error";
function parseMode(raw?: string): ClickMode {
  return raw === "first" || raw === "last" || raw === "error" ? raw : "all";
}

// Most-clicked elements on a page, by CSS selector.
export async function getRankedElements(req: FastifyRequest<GetRankedElementsRequest>, res: FastifyReply) {
  const { filters, pathname, hostname, device, goalId, segment, limit } = req.query;
  const site = req.params.siteId;
  const mode = parseMode(req.query.mode);

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

  const eventType = mode === "error" ? "error" : "click";
  // Base predicate without the element-selector filter (needed inside the per-session
  // first/last subquery, where the "first click" must be chosen across all clicks).
  const baseWhere = `
    site_id = {siteId:Int32}
    AND pathname = {pathname:String}
    AND event_type = '${eventType}'
    ${hostname ? "AND hostname = {hostname:String}" : ""}
    ${device ? "AND device_type = {device:String}" : ""}
    ${filterStatement}
    ${goalFilter}
    ${timeStatement}
  `;

  // first/last collapse to one click per session before ranking elements;
  // all/error select the raw click rows. Either way `source` is a subquery so the
  // outer `WHERE element_selector != ''` composes the same.
  const sessionPick = mode === "first" ? "argMin" : "argMax";
  const source =
    mode === "first" || mode === "last"
      ? `(
          SELECT
            ${sessionPick}(element_selector, timestamp) AS element_selector,
            ${sessionPick}(element_text, timestamp) AS element_text,
            ${sessionPick}(x_percent, timestamp) AS x_percent,
            ${sessionPick}(y_absolute, timestamp) AS y_absolute
          FROM heatmap_events
          WHERE ${baseWhere} AND session_id != ''
          GROUP BY session_id
        )`
      : `(
          SELECT element_selector, element_text, x_percent, y_absolute
          FROM heatmap_events
          WHERE ${baseWhere}
        )`;

  const elementsQuery = `
    SELECT
      element_selector,
      any(element_text) AS element_text,
      count() AS clicks,
      avg(x_percent) AS avg_x,
      avg(y_absolute) AS avg_y
    FROM ${source}
    WHERE element_selector != ''
    GROUP BY element_selector
    ORDER BY clicks DESC
    LIMIT {limit:Int32}
  `;

  const totalQuery = `
    SELECT count() AS total
    FROM ${source}
    WHERE element_selector != ''
  `;

  try {
    const queryParams = { siteId: Number(site), pathname, limit: parsedLimit, ...(hostname ? { hostname } : {}), ...(device ? { device } : {}) };
    const [elementsResult, totalResult] = await Promise.all([
      clickhouse.query({ query: elementsQuery, format: "JSONEachRow", query_params: queryParams }),
      clickhouse.query({ query: totalQuery, format: "JSONEachRow", query_params: queryParams }),
    ]);

    const elements = await processResults<{
      element_selector: string;
      element_text: string;
      clicks: number;
      avg_x: number;
      avg_y: number;
    }>(elementsResult);
    const totals = await processResults<{ total: number }>(totalResult);
    const total = totals[0]?.total ?? 0;

    const ranked: RankedElement[] = elements.map(e => ({
      element_selector: e.element_selector,
      element_text: e.element_text,
      clicks: Number(e.clicks),
      percentage: total > 0 ? Math.round((Number(e.clicks) / total) * 1000) / 10 : 0,
      avg_x: Number(e.avg_x) || 0,
      avg_y: Number(e.avg_y) || 0,
    }));

    return res.send({ data: ranked });
  } catch (error) {
    console.error("Error fetching ranked elements:", error);
    return res.status(500).send({ error: "Failed to fetch ranked elements" });
  }
}
