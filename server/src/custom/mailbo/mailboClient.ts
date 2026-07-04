import { createServiceLogger } from "../../lib/logger/logger.js";

const logger = createServiceLogger("mailbo-client");

export interface MailboContactUpsert {
  email: string;
  first_name?: string;
  last_name?: string;
  status?: "subscribed" | "pending";
  source?: string;
  attrs?: Record<string, unknown>;
}

export interface MailboEvent {
  email: string;
  type: string;
  meta?: Record<string, unknown>;
  touch_activity?: boolean;
}

async function post(baseUrl: string, apiKey: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mailbo ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

// Upsert a contact by email. Returns contact id when the API provides one.
export async function upsertContact(
  baseUrl: string,
  apiKey: string,
  contact: MailboContactUpsert
): Promise<string | undefined> {
  const payload = { status: "subscribed", source: "rybbit-analytics", ...contact };
  const res = await post(baseUrl, apiKey, "/contacts", payload);
  return res?.id || res?.contact?.id || res?.data?.id;
}

export async function sendEvent(baseUrl: string, apiKey: string, event: MailboEvent): Promise<void> {
  await post(baseUrl, apiKey, "/events", { touch_activity: true, ...event });
}

// Best-effort connectivity check for the settings "Test connection" button.
export async function testConnection(baseUrl: string, apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${baseUrl}/custom-fields`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (error) {
    logger.error({ error }, "Mailbo test connection failed");
    return { ok: false, error: error instanceof Error ? error.message : "unknown" };
  }
}
