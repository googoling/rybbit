import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getFilterStatement } from "../analytics/utils/getFilterStatement.js";
import { getTimeStatement, processResults } from "../analytics/utils/utils.js";
import { getGoalSessionFilter } from "./goalSessionFilter.js";

type Point = { x_percent: number; y_absolute: number; count: number };
type InsightElement = { element_selector: string; element_text: string; count: number };

export type GetClickInsightsResponse = {
  rage: { points: Point[]; total: number };
  dead: { points: Point[]; total: number };
  topRageElements: InsightElement[];
  topDeadElements: InsightElement[];
};

export interface GetClickInsightsRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{
    pathname: string;
    device?: string;
    goalId?: string;
    segment?: string;
  }>;
}

const TOP_ELEMENTS = 5;

// Rage clicks (frustration bursts) + dead clicks (clicks that did nothing), with hotspots + top elements.
export async function getClickInsights(req: FastifyRequest<GetClickInsightsRequest>, res: FastifyReply) {
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

  const baseWhere = `
    site_id = {siteId:Int32}
    AND pathname = {pathname:String}
    AND event_type IN ('rage', 'dead')
    ${device ? "AND device_type = {device:String}" : ""}
    ${filterStatement}
    ${goalFilter}
    ${timeStatement}
  `;

  const pointsQuery = `
    SELECT
      event_type,
      round(x_percent * 2) / 2 AS x_percent,
      floor(y_absolute / 8) * 8 AS y_absolute,
      count() AS count
    FROM heatmap_events
    WHERE ${baseWhere}
    GROUP BY event_type, x_percent, y_absolute
  `;

  const elementsQuery = `
    SELECT
      event_type,
      element_selector,
      any(element_text) AS element_text,
      count() AS count
    FROM heatmap_events
    WHERE ${baseWhere} AND element_selector != ''
    GROUP BY event_type, element_selector
    ORDER BY count DESC
  `;

  try {
    const queryParams = { siteId: Number(site), pathname, ...(device ? { device } : {}) };
    const [pointsResult, elementsResult] = await Promise.all([
      clickhouse.query({ query: pointsQuery, format: "JSONEachRow", query_params: queryParams }),
      clickhouse.query({ query: elementsQuery, format: "JSONEachRow", query_params: queryParams }),
    ]);

    const pointRows = await processResults<{ event_type: string } & Point>(pointsResult);
    const elementRows = await processResults<{ event_type: string } & InsightElement>(elementsResult);

    const ragePoints = pointRows.filter(r => r.event_type === "rage").map(({ x_percent, y_absolute, count }) => ({
      x_percent,
      y_absolute,
      count: Number(count),
    }));
    const deadPoints = pointRows.filter(r => r.event_type === "dead").map(({ x_percent, y_absolute, count }) => ({
      x_percent,
      y_absolute,
      count: Number(count),
    }));

    const toElements = (type: string) =>
      elementRows
        .filter(r => r.event_type === type)
        .slice(0, TOP_ELEMENTS)
        .map(({ element_selector, element_text, count }) => ({
          element_selector,
          element_text,
          count: Number(count),
        }));

    return res.send({
      data: {
        rage: { points: ragePoints, total: ragePoints.reduce((s, p) => s + p.count, 0) },
        dead: { points: deadPoints, total: deadPoints.reduce((s, p) => s + p.count, 0) },
        topRageElements: toElements("rage"),
        topDeadElements: toElements("dead"),
      },
    });
  } catch (error) {
    console.error("Error fetching click insights:", error);
    return res.status(500).send({ error: "Failed to fetch click insights" });
  }
}
