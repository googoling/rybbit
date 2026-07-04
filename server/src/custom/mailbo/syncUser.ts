import { sql } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { getConfig, getSentMilestones, saveSyncState } from "./config.js";
import { computeSnapshot } from "./snapshot.js";
import { MILESTONES, Milestone, milestoneMeta, milestoneTitle } from "./labels.js";
import { sendEvent, upsertContact } from "./mailboClient.js";

const logger = createServiceLogger("mailbo-sync");

const emailCache = new Map<string, { email: string | null; at: number }>();
const EMAIL_TTL_MS = 5 * 60_000;

async function resolveEmail(siteId: number, identifiedUserId: string): Promise<string | null> {
  const key = `${siteId}:${identifiedUserId}`;
  const hit = emailCache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < EMAIL_TTL_MS) return hit.email;

  const rows = await db.execute<{ email: string }>(
    sql`SELECT traits->>'email' AS email FROM user_profiles
        WHERE site_id = ${siteId} AND user_id = ${identifiedUserId} AND traits ? 'email' LIMIT 1`
  );
  const email = ((rows as any[])[0]?.email as string) || null;
  emailCache.set(key, { email, at: now });
  return email;
}

// Recompute + push one user to Mailbo. Idempotent; safe to call repeatedly.
export async function syncUser(siteId: number, identifiedUserId: string): Promise<void> {
  const config = await getConfig(siteId);
  if (!config || !config.enabled || !config.apiKey) return;

  const email = await resolveEmail(siteId, identifiedUserId);
  if (!email) return;

  const snapshot = await computeSnapshot(siteId, identifiedUserId, email);
  if (!snapshot) return;

  try {
    await upsertContact(config.baseUrl, config.apiKey, { email, attrs: snapshot.attrs });

    const sent = await getSentMilestones(siteId, email);
    const newMilestones = MILESTONES.filter(m => snapshot.reached.has(m) && !sent.has(m));

    // Mailbo stores only `type` + `meta` and renders the raw `type` as the
    // Activity headline, so send the human label AS the type + structured meta.
    for (const m of newMilestones) {
      await sendEvent(config.baseUrl, config.apiKey, {
        email,
        type: milestoneTitle(m as Milestone, snapshot.milestoneCtx),
        meta: milestoneMeta(m as Milestone, snapshot.milestoneCtx),
      });
    }

    if (newMilestones.length > 0) {
      await saveSyncState(siteId, email, [...sent, ...newMilestones]);
    }
  } catch (error) {
    logger.error({ siteId, email, error: error instanceof Error ? error.message : error }, "Mailbo sync failed");
  }
}
