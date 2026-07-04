import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { processResults } from "../../api/analytics/utils/utils.js";
import { FURTHEST_STEP_LABELS, Milestone, MILESTONES, TOOL_LABELS, toolLabel } from "./labels.js";

export interface UserSnapshot {
  email: string;
  attrs: Record<string, unknown>;
  reached: Set<Milestone>;
  milestoneTimes: Partial<Record<Milestone, string>>;
  milestoneCtx: { tool?: string; plan?: string; price?: string };
  lastActive: string;
}

const TOOL_REGEX = Object.keys(TOOL_LABELS)
  .filter(s => s !== "generate")
  .join("|");

interface Row {
  last_active: string;
  country: string;
  designs_generated: number;
  pricing_views: number;
  m_signup_started: number;
  m_signup_verified: number;
  m_email_verified: number;
  m_pricing_viewed: number;
  m_checkout_started: number;
  m_checkout_completed: number;
  plan_considered: string;
  plan_price: string;
  first_tool: string;
  tool_paths: string[];
  event_tools: string[];
  ts_signup_started: string;
  ts_signup_verified: string;
  ts_email_verified: string;
  ts_first_design: string;
  ts_pricing_viewed: string;
  ts_checkout_started: string;
  ts_checkout_completed: string;
}

// Recompute a user's rolled-up intent snapshot from ClickHouse. One aggregation query.
export async function computeSnapshot(
  siteId: number,
  identifiedUserId: string,
  email: string
): Promise<UserSnapshot | null> {
  const query = `
    SELECT
      toString(max(timestamp)) AS last_active,
      argMax(country, timestamp) AS country,
      countIf(type = 'custom_event' AND event_name = 'design_generated') AS designs_generated,
      countIf(type = 'custom_event' AND event_name = 'pricing_viewed') AS pricing_views,
      maxIf(1, type = 'custom_event' AND event_name IN ('signup_started','signup_submitted')) AS m_signup_started,
      maxIf(1, type = 'custom_event' AND event_name = 'signup_verified') AS m_signup_verified,
      maxIf(1, type = 'custom_event' AND event_name = 'email_verified') AS m_email_verified,
      maxIf(1, type = 'custom_event' AND event_name = 'pricing_viewed') AS m_pricing_viewed,
      maxIf(1, type = 'custom_event' AND event_name = 'checkout_started') AS m_checkout_started,
      maxIf(1, type = 'custom_event' AND event_name = 'checkout_completed') AS m_checkout_completed,
      argMaxIf(JSONExtractString(toString(props), 'plan_name'), timestamp,
        type = 'custom_event' AND event_name = 'checkout_started'
        AND JSONExtractString(toString(props), 'plan_name') != '') AS plan_considered,
      argMaxIf(JSONExtractString(toString(props), 'price'), timestamp,
        type = 'custom_event' AND event_name = 'checkout_started'
        AND JSONExtractString(toString(props), 'plan_name') != '') AS plan_price,
      argMaxIf(JSONExtractString(toString(props), 'tool'), timestamp,
        type = 'custom_event' AND event_name IN ('design_generated','first_design_generated','generate_attempted')
        AND JSONExtractString(toString(props), 'tool') != '') AS first_tool,
      groupArrayIf(pathname, type = 'pageview' AND match(pathname, {toolRegex:String})) AS tool_paths,
      groupArrayIf(JSONExtractString(toString(props), 'tool'), type = 'custom_event'
        AND event_name IN ('design_generated','first_design_generated','generate_attempted')
        AND JSONExtractString(toString(props), 'tool') != '') AS event_tools,
      toString(minIf(timestamp, type = 'custom_event' AND event_name IN ('signup_started','signup_submitted'))) AS ts_signup_started,
      toString(minIf(timestamp, type = 'custom_event' AND event_name = 'signup_verified')) AS ts_signup_verified,
      toString(minIf(timestamp, type = 'custom_event' AND event_name = 'email_verified')) AS ts_email_verified,
      toString(minIf(timestamp, type = 'custom_event' AND event_name = 'design_generated')) AS ts_first_design,
      toString(minIf(timestamp, type = 'custom_event' AND event_name = 'pricing_viewed')) AS ts_pricing_viewed,
      toString(minIf(timestamp, type = 'custom_event' AND event_name = 'checkout_started')) AS ts_checkout_started,
      toString(minIf(timestamp, type = 'custom_event' AND event_name = 'checkout_completed')) AS ts_checkout_completed
    FROM events
    WHERE site_id = {siteId:Int32} AND identified_user_id = {uid:String}
  `;

  const result = await clickhouse.query({
    query,
    format: "JSONEachRow",
    query_params: { siteId, uid: identifiedUserId, toolRegex: TOOL_REGEX },
  });
  const rows = await processResults<Row>(result);
  const r = rows[0];
  if (!r || !r.last_active || r.last_active.startsWith("1970")) return null;

  const reached = new Set<Milestone>();
  if (r.m_signup_started) reached.add("signup_started");
  if (r.m_signup_verified) reached.add("signup_verified");
  if (r.m_email_verified) reached.add("email_verified");
  if (Number(r.designs_generated) > 0) reached.add("first_design_generated");
  if (r.m_pricing_viewed) reached.add("pricing_viewed");
  if (r.m_checkout_started) reached.add("checkout_started");
  if (r.m_checkout_completed) reached.add("checkout_completed");

  const toolCounts = new Map<string, number>();
  for (const p of [...(r.tool_paths || []), ...(r.event_tools || [])]) {
    const label = toolLabel(p);
    if (label) toolCounts.set(label, (toolCounts.get(label) || 0) + 1);
  }
  const toolsRankedEntries = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
  // "Kitchen Redesign (5), Room Redesign (3)" — count = engagement strength.
  const toolsExplored = toolsRankedEntries.map(([t, c]) => `${t} (${c})`).join(", ");
  const primaryInterest = toolLabel(r.first_tool) || toolsRankedEntries[0]?.[0] || "";

  const furthest = [...MILESTONES].reverse().find(m => reached.has(m));
  const status = deriveStatus(reached, Number(r.designs_generated));

  const validTs = (t: string | undefined) => (t && !t.startsWith("1970") ? t : undefined);
  const milestoneTimes: Partial<Record<Milestone, string>> = {
    signup_started: validTs(r.ts_signup_started),
    signup_verified: validTs(r.ts_signup_verified),
    email_verified: validTs(r.ts_email_verified),
    first_design_generated: validTs(r.ts_first_design),
    pricing_viewed: validTs(r.ts_pricing_viewed),
    checkout_started: validTs(r.ts_checkout_started),
    checkout_completed: validTs(r.ts_checkout_completed),
  };

  const attrs: Record<string, unknown> = {
    // country intentionally NOT sent — the DecorAI backend owns it (disjoint writer).
    intent_primary_interest: primaryInterest || undefined,
    intent_tools_explored: toolsExplored || undefined,
    intent_pricing_views: Number(r.pricing_views) || 0,
    intent_furthest_step: furthest ? FURTHEST_STEP_LABELS[furthest] : undefined,
    intent_plan_considered: r.plan_considered
      ? `${r.plan_considered}${r.plan_price ? ` ($${r.plan_price})` : ""}`
      : undefined,
    intent_status: status,
    intent_last_active: r.last_active.slice(0, 10),
  };
  for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k];

  return {
    email,
    attrs,
    reached,
    milestoneTimes,
    milestoneCtx: { tool: r.first_tool, plan: r.plan_considered, price: r.plan_price },
    lastActive: r.last_active,
  };
}

function deriveStatus(reached: Set<Milestone>, designs: number): string {
  if (reached.has("checkout_completed")) return "Converted";
  if (reached.has("checkout_started")) return "Abandoned checkout";
  if (reached.has("pricing_viewed")) return "Viewed pricing, no checkout";
  if (designs > 0) return "Active generator";
  if (reached.has("signup_verified")) return "Signed up, no design";
  return "Browsing";
}
