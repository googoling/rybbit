import { sql } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import { Milestone } from "./labels.js";
import { decrypt, encrypt } from "./crypto.js";

export interface MailboConfig {
  siteId: number;
  apiKey: string;
  enabled: boolean;
  baseUrl: string;
}

const cache = new Map<number, { value: MailboConfig | null; at: number }>();
const TTL_MS = 30_000;

export async function getConfig(siteId: number): Promise<MailboConfig | null> {
  const hit = cache.get(siteId);
  const now = Date.now();
  if (hit && now - hit.at < TTL_MS) return hit.value;

  let value: MailboConfig | null = null;
  try {
    const rows = await db.execute<{ site_id: number; api_key: string; enabled: boolean; base_url: string }>(
      sql`SELECT site_id, api_key, enabled, base_url FROM mailbo_integration_config WHERE site_id = ${siteId} LIMIT 1`
    );
    const row = (rows as any[])[0];
    value = row
      ? { siteId: row.site_id, apiKey: row.api_key ? decrypt(row.api_key) : "", enabled: row.enabled, baseUrl: row.base_url }
      : null;
  } catch {
    // Table not yet created (schema.sql not applied) → treat as not configured.
    value = null;
  }
  cache.set(siteId, { value, at: now });
  return value;
}

export async function saveConfig(
  siteId: number,
  patch: { apiKey?: string; enabled?: boolean; baseUrl?: string }
): Promise<void> {
  const baseUrl = patch.baseUrl ?? "https://mailbo.io/api/v1";
  // Encrypt only when a new key is provided; undefined = leave existing untouched.
  const encKey = patch.apiKey === undefined ? null : patch.apiKey ? encrypt(patch.apiKey) : "";
  await db.execute(sql`
    INSERT INTO mailbo_integration_config (site_id, api_key, enabled, base_url, updated_at)
    VALUES (${siteId}, ${encKey ?? ""}, ${patch.enabled ?? false}, ${baseUrl}, now())
    ON CONFLICT (site_id) DO UPDATE SET
      api_key = COALESCE(${encKey}, mailbo_integration_config.api_key),
      enabled = ${patch.enabled ?? false},
      base_url = ${baseUrl},
      updated_at = now()
  `);
  cache.delete(siteId);
}

export async function getSentMilestones(siteId: number, email: string): Promise<Set<Milestone>> {
  const rows = await db.execute<{ sent_milestones: Milestone[] }>(
    sql`SELECT sent_milestones FROM mailbo_sync_state WHERE site_id = ${siteId} AND email = ${email} LIMIT 1`
  );
  const arr = (rows as any[])[0]?.sent_milestones;
  return new Set(Array.isArray(arr) ? arr : []);
}

export async function saveSyncState(siteId: number, email: string, sent: Milestone[]): Promise<void> {
  await db.execute(sql`
    INSERT INTO mailbo_sync_state (site_id, email, sent_milestones, last_synced_at)
    VALUES (${siteId}, ${email}, ${JSON.stringify(sent)}::jsonb, now())
    ON CONFLICT (site_id, email) DO UPDATE SET
      sent_milestones = ${JSON.stringify(sent)}::jsonb,
      last_synced_at = now()
  `);
}
