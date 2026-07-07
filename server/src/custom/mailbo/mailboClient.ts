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

async function send(baseUrl: string, apiKey: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function requestJson(baseUrl: string, apiKey: string, method: string, path: string, body: unknown): Promise<any> {
  const res = await send(baseUrl, apiKey, method, path, body);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mailbo ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

async function post(baseUrl: string, apiKey: string, path: string, body: unknown): Promise<any> {
  return requestJson(baseUrl, apiKey, "POST", path, body);
}

// Look up a contact by email. Returns its id, null when absent (404), throws on other errors.
async function findContactId(baseUrl: string, apiKey: string, email: string): Promise<string | null> {
  const res = await send(baseUrl, apiKey, "GET", `/contacts/${encodeURIComponent(email)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mailbo GET /contacts ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = await res.json().catch(() => ({}));
  return json?.data?.id || json?.id || null;
}

// Upsert a contact by email. We only own the intent attrs, so for an existing
// contact we PATCH attrs (merged) and never touch status/source/name that the
// DecorAI backend owns; only a brand-new contact is created via POST.
export async function upsertContact(
  baseUrl: string,
  apiKey: string,
  contact: MailboContactUpsert
): Promise<string | undefined> {
  const existingId = await findContactId(baseUrl, apiKey, contact.email);
  if (existingId) {
    const res = await requestJson(baseUrl, apiKey, "PATCH", `/contacts/${encodeURIComponent(contact.email)}`, {
      attrs: contact.attrs,
    });
    return res?.data?.id || res?.id || existingId;
  }
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
