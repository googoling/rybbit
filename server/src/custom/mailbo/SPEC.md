# Mailbo integration (rybbit → Mailbo) — locked spec

Custom fork module. Pushes DecorAI behavioral **intent** from rybbit analytics into Mailbo contacts
so Mailbo's AI agent can send lifecycle emails. See `/FORK_MAINTENANCE.md` for fork rules.

## Principle
**Send conclusions in plain English, not raw clicks.** rybbit reads + translates; Mailbo receives a
readable snapshot + a de-duplicated milestone timeline. Fast on both sides, legible to human or agent.

## Direction & writer boundary
- One-way: **rybbit → Mailbo**. Join key = **email** (from `user_profiles.traits.email`, 100% present on site 3).
- rybbit writes ONLY `intent_*` attributes + intent milestone events. It NEVER writes the billing/usage
  facts the DecorAI backend owns (`current_plan`, `subscription_status`, `credits_remaining`, purchases).
  Disjoint field sets → no clobber, "sole writer per field" preserved.

## Billing caveat (from live data)
`checkout_completed` fires with NO props, and the processor is **Paddle** (`subscription-management.paddle.com`).
So rybbit sends purchase **intent** only (`checkout_started` w/ plan+price). Authoritative purchase facts
(plan, amount, status) come from **backend → Mailbo `/purchases`**, not here.

## What we SEND

### Contact attributes (upserted snapshot — fixed size, never grows)
| Mailbo attr | Source (ClickHouse rollup for the user) |
|---|---|
| `intent_primary_interest` | most-visited tool page, human label |
| `intent_tools_explored` | distinct tool pages visited, human labels, comma-joined |
| `intent_designs_generated` | count of `design_generated` |
| `intent_pricing_views` | count of `pricing_viewed` |
| `intent_furthest_step` | furthest lifecycle stage reached (human label) |
| `intent_plan_considered` | last `checkout_started.plan_name` (+ price) |
| `intent_status` | derived: "Abandoned checkout" / "Active generator" / "Signed up, no design" / … |
| `intent_last_active` | max event timestamp (date) |

> `country` is NOT written by rybbit — the DecorAI backend owns it (disjoint writer).

### Milestone events (de-duplicated — first occurrence only, human title)
`signup_started` · `signup_verified` · `email_verified` · `first_design_generated {tool}` ·
`pricing_viewed` · `checkout_started {plan, price}` · `checkout_completed`.
Each sent to Mailbo `POST /events` with a human `title`. Dedup via per-user `sent_milestones` in
`mailbo_sync_state` — a milestone is sent once, ever.

## What we DROP (proven noise/secrets — 60d site-3 volumes)
button_click (52k, UI junk + PII), performance (25k), input_change/form_submit (junk/PII), error,
auth-plumbing pageviews (`/authorize`,`/sso`,`/login`,`/register`,`/email-verification`), OAuth outbound
(accounts.google.com / appleid.apple.com). Querystrings stripped from every URL.

## Sync model (event-triggered, debounced recompute)
1. rybbit ingests a relevant event (identified user) → `onEvent` enqueues `{siteId, identifiedUserId}`.
2. Per-user debounce (~45s after last activity) → `syncUser`:
   - resolve email; bail if none or integration disabled.
   - recompute the snapshot + reached-milestone set from ClickHouse (one aggregation query).
   - read `mailbo_sync_state.sent_milestones`; compute NEW milestones.
   - Mailbo: upsert contact + `intent_*` attrs; POST new milestone events; update sync_state.
3. Async, fire-and-forget, batched — never blocks `trackEvent`. Idempotent (recompute = current state).

## Tool label dictionary (slug → human)
room-redesign→Room Redesign · kitchen-redesign→Kitchen Redesign · bathroom-redesign→Bathroom Redesign ·
exterior-redesign→Exterior Redesign · landscape-redesign→Landscape Redesign · sketch-to-render→Sketch to Render ·
floor-plan-to-3d→Floor Plan to 3D · magic-edit→Magic Edit · generate→Generate.

## Config storage (no upstream schema edits)
Two custom tables created by `schema.sql` (applied MANUALLY per the no-auto-migration rule), accessed via
raw `db.execute(sql\`…\`)`:
- `mailbo_integration_config(site_id PK, api_key, enabled, base_url, updated_at)`
- `mailbo_sync_state(site_id, email, sent_milestones jsonb, last_synced_at, PRIMARY KEY(site_id,email))`

API key is entered in the per-site Settings → Mailbo tab. Stored server-side; never returned in full to the client (masked).
