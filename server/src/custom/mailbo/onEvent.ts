import { getConfig } from "./config.js";
import { enqueueUserSync } from "./queue.js";
import { TOOL_PATHNAMES } from "./labels.js";

// Custom events that move a user's intent picture (trigger a debounced sync).
const RELEVANT_EVENTS = new Set([
  "signup_started",
  "signup_submitted",
  "signup_verified",
  "email_verified",
  "social_signup",
  "login_completed",
  "generate_attempted",
  "design_generated",
  "first_design_generated",
  "pricing_viewed",
  "checkout_started",
  "checkout_completed",
]);

function isToolPageview(type: string, pathname?: string): boolean {
  if (type !== "pageview" || !pathname) return false;
  const clean = pathname.replace(/^\/(beta\/)?/, "").replace(/\/$/, "");
  return TOOL_PATHNAMES.includes(clean);
}

export interface MailboEventHook {
  siteId: number;
  identifiedUserId?: string;
  type: string;
  eventName?: string;
  pathname?: string;
}

// Called (fire-and-forget) from trackEvent after a successful ingest. Never throws, never blocks.
export function onMailboEvent(e: MailboEventHook): void {
  try {
    if (!e.identifiedUserId) return;
    const relevant =
      (e.type === "custom_event" && e.eventName && RELEVANT_EVENTS.has(e.eventName)) ||
      isToolPageview(e.type, e.pathname);
    if (!relevant) return;

    // Cheap gate before touching the queue: skip entirely if integration is off.
    getConfig(e.siteId)
      .then(config => {
        if (config?.enabled && config.apiKey) enqueueUserSync(e.siteId, e.identifiedUserId!);
      })
      .catch(() => {});
  } catch {
    // never disrupt ingestion
  }
}
