import { createServiceLogger } from "../../lib/logger/logger.js";
import { syncUser } from "./syncUser.js";

const logger = createServiceLogger("mailbo-queue");

// Per-user debounce: coalesce a burst of activity into one recompute+push.
const DEBOUNCE_MS = 45_000;
const timers = new Map<string, NodeJS.Timeout>();

export function enqueueUserSync(siteId: number, identifiedUserId: string): void {
  const key = `${siteId}:${identifiedUserId}`;
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    timers.delete(key);
    // Fire-and-forget; syncUser catches its own errors.
    syncUser(siteId, identifiedUserId).catch(error =>
      logger.error({ siteId, error: error instanceof Error ? error.message : error }, "sync threw")
    );
  }, DEBOUNCE_MS);

  if (typeof timer.unref === "function") timer.unref();
  timers.set(key, timer);
}
