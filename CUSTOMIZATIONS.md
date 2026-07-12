# Customizations (divergence map from upstream Rybbit)

Every upstream file we have modified **in place**, and why. This is the merge-conflict map used
during upstream updates — see `/FORK_MAINTENANCE.md`. Update this whenever you edit an upstream file.
New modules under `server/src/custom/` and `client/src/custom/` do NOT need to be listed here
(they never conflict).

## Custom features (whole features we built — upstream has none of these)

### Heatmaps (our feature — commit `329cc83d` "Add heatmaps feature M0–M4" + follow-ups)
Upstream Rybbit has **no** heatmaps. Do NOT move this into `custom/` — its own code already lives
in dedicated directories upstream never uses (so they can't conflict), and moving it would be a
huge risky diff for zero merge-safety gain. What DOES matter for merges are the shared upstream
files it hooks into — **protect these during any upstream merge**:

Self-contained (conflict-proof, leave as-is): `server/src/api/heatmap/**`, `server/src/types/heatmap.ts`,
`server/src/services/tracker/heatmapQueue.ts`, `server/src/analytics-script/heatmapTracking.ts`,
`server/src/analytics-script/heatmapSnapshot.ts`, `client/src/app/[site]/heatmaps/**`,
`client/src/lib/heatmap/**`, `client/src/api/analytics/hooks/heatmap/**`, `client/src/api/analytics/endpoints/heatmap.ts`.

Shared upstream files heatmap edits IN PLACE (the real conflict surface):
| File | Heatmap hook |
|---|---|
| `server/src/index.ts` | registers heatmap route plugin |
| `server/src/db/postgres/schema.ts` | heatmap tables/columns |
| `server/src/db/clickhouse/clickhouse.ts` | ClickHouse heatmap tables (`heatmap_events`, `heatmap_snapshots`) |
| `server/src/lib/siteConfig.ts` | per-site heatmap enable flag |
| `server/src/lib/cors.ts` | CORS for heatmap capture endpoints |
| `server/src/analytics-script/{index,config,types}.ts` | injects heatmap tracking into the tracking script |
| `server/src/api/sites/{getSite,getTrackingConfig,updateSiteConfig}.ts` | heatmap site-config toggles |
| `client/src/app/[site]/components/Sidebar/Sidebar.tsx` | Heatmaps nav item |
| `client/src/components/SiteSettings/TrackingTab.tsx` | heatmap enable toggle UI |
| `client/src/lib/filterGroups.ts`, `client/src/app/[site]/components/SubHeader/Export/exportCsv.ts` | smaller touches |

Deploy default image tag is `heatmap`; health check verifies `heatmap_events` / `heatmap_snapshots` tables exist.

### Mailbo integration (our feature — `server/src/custom/mailbo/`, `client/src/custom/mailbo/`)
Rybbit → Mailbo intent sync. Self-contained module (conflict-proof). Spec in
`server/src/custom/mailbo/SPEC.md`. Custom tables via `schema.sql` (applied manually — no auto-migration).
Shared upstream files it hooks into (protect on merge):
| File | Hook |
|---|---|
| `server/src/index.ts` | registers `mailboRoutes` (`// CUSTOM`) |
| `server/src/services/tracker/trackEvent.ts` | calls `onMailboEvent(...)` after ingest (`// CUSTOM`) |
| `client/src/components/SiteSettings/SiteSettings.tsx` | adds the "Mailbo" settings tab (`// CUSTOM`) |

## In-place edits to upstream files

| File | What we changed | Commit / note |
|---|---|---|
| `server/src/api/analytics/goals/getGoalSessions.ts` | Enrich converted sessions with user traits (select `identified_user_id`, call `enrichWithTraits`) so names/emails resolve on the Goals card. | `f98b8394` |
| `server/src/api/analytics/goals/getGoalSessions.ts` | Prior: default `page` param to 1. | upstream PR #940 (already merged) |
| `client/src/lib/heatmap/renderHeatmap.ts` | Heatmap rendering tweaks (overlay opacity, click rendering). | Heatmaps rebuild work |
| `server/src/api/heatmap/getClickHeatmap.ts` | Click heatmap query changes. | Heatmaps rebuild work |
| `server/src/services/tracker/utils.ts` | `clearSelfReferrer` now strips `www.` and treats subdomain relationships both ways as internal (e.g. `app.decorai.io` ↔ `decorai.io`), so cross-subdomain self-referrals don't pollute the Referrers list. | `// CUSTOM` |
| Sidebar nav component | Hide **Query** and **Dashboards** nav items. | `0736bbf0` |
| Heatmaps UI (Click tab) | Active-pill styling, transparent caret split-button, adjustable overlay opacity slider. | `77e22bc0`, `e9b54bc9`, `5f063935` |

> Tagging feature was upstream PR #941 (merged), not a local customization.

## Notes
- Keep this table current. When resolving a merge conflict, this is the list of things to protect.
- For anything here, prefer refactoring the custom logic into a `custom/` helper so the in-place
  edit shrinks to a one-line call over time.
