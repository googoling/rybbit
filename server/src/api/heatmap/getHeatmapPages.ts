import { FilterParams } from "@rybbit/shared";
import { FastifyReply, FastifyRequest } from "fastify";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getFilterStatement } from "../analytics/utils/getFilterStatement.js";
import { getTimeStatement, processResults } from "../analytics/utils/utils.js";

export type HeatmapPage = { hostname: string; pathname: string; events: number; sessions: number };

export interface GetHeatmapPagesRequest {
  Params: { siteId: string };
  Querystring: FilterParams<{ device?: string }>;
}

const PAGE_LIMIT = 200;

// Pages that actually have heatmap data, for the page picker (most active first).
export async function getHeatmapPages(req: FastifyRequest<GetHeatmapPagesRequest>, res: FastifyReply) {
  const { filters, device } = req.query;
  const site = req.params.siteId;

  const timeStatement = getTimeStatement(req.query);
  const filterStatement = getFilterStatement(filters, Number(site), timeStatement);

  const query = `
    SELECT hostname, pathname, count() AS events, uniqExact(session_id) AS sessions
    FROM heatmap_events
    WHERE site_id = {siteId:Int32}
      ${device ? "AND device_type = {device:String}" : ""}
      ${filterStatement}
      ${timeStatement}
    GROUP BY hostname, pathname
    ORDER BY sessions DESC
    LIMIT {limit:Int32}
  `;

  try {
    const result = await clickhouse.query({
      query,
      format: "JSONEachRow",
      query_params: { siteId: Number(site), limit: PAGE_LIMIT, ...(device ? { device } : {}) },
    });

    const pages = await processResults<HeatmapPage>(result);
    return res.send({ data: pages });
  } catch (error) {
    console.error("Error fetching heatmap pages:", error);
    return res.status(500).send({ error: "Failed to fetch heatmap pages" });
  }
}
