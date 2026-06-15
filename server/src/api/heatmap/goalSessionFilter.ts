import { eq } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import { goals } from "../../db/postgres/schema.js";
import { buildGoalCondition } from "../analytics/goals/goalConditions.js";

export type HeatmapSegment = "all" | "converters" | "non_converters";

// Returns a SQL fragment to append to a heatmap_events WHERE clause that restricts to
// (converters) or excludes (non_converters) the sessions that completed `goalId`.
// Returns "" when not segmenting, the goal is unknown, or it belongs to another site.
// `timeStatement` (the heatmap query's time clause) is reused to scope goal completion,
// and {siteId:Int32} must be bound in the calling query's query_params.
export async function getGoalSessionFilter(opts: {
  siteId: number;
  goalId?: number | null;
  segment?: string;
  timeStatement: string;
}): Promise<string> {
  const { siteId, goalId, segment, timeStatement } = opts;
  if (!goalId || !segment || segment === "all") return "";
  if (segment !== "converters" && segment !== "non_converters") return "";

  const rows = await db.select().from(goals).where(eq(goals.goalId, Number(goalId))).limit(1);
  const goal = rows[0];
  // Unknown goal or cross-site access → fall back to no segmentation (safe default).
  if (!goal || goal.siteId !== siteId || !goal.config) return "";

  const condition = buildGoalCondition({ goalType: goal.goalType, config: goal.config });
  if (!condition) return "";

  const op = segment === "non_converters" ? "NOT IN" : "IN";
  return `
    AND session_id ${op} (
      SELECT DISTINCT session_id FROM events
      WHERE site_id = {siteId:Int32} AND (${condition}) ${timeStatement}
    )`;
}
