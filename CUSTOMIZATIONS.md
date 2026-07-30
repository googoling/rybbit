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
`server/src/analytics-script/heatmapSnapshot.ts`, `server/src/db/clickhouse/schema/heatmaps.ts`,
`client/src/app/[site]/heatmaps/**`,
`client/src/lib/heatmap/**`, `client/src/api/analytics/hooks/heatmap/**`, `client/src/api/analytics/endpoints/heatmap.ts`.

Shared upstream files heatmap edits IN PLACE (the real conflict surface):
| File | Heatmap hook |
|---|---|
| `server/src/index.ts` | registers heatmap route plugin |
| `server/src/db/postgres/schema.ts` | heatmap tables/columns |
| `server/src/db/clickhouse/clickhouse.ts` | ONE line: `await initializeHeatmapTables(); // CUSTOM`. v2.8.0 split this file into `schema/{core,cloud,liteDashboard}.ts`; our DDL moved to its own `schema/heatmaps.ts` so only the dispatcher call remains |
| `server/src/lib/siteConfig.ts` | per-site heatmap enable flag |
| `server/src/lib/cors.ts` | CORS for heatmap capture endpoints |
| `server/src/analytics-script/{index,config,types}.ts` | injects heatmap tracking into the tracking script |
| `server/src/api/sites/{getSite,getTrackingConfig,updateSiteConfig}.ts` | heatmap site-config toggles |
| `server/src/services/sites/siteConfigurationLifecycle.ts` | v2.8.0 moved the site-update body here — `enableHeatmaps`/`heatmapSampleRate` must be in BOTH `UpdateSiteConfigurationInput` and `DIRECT_UPDATE_FIELDS`, or the toggles silently no-op |
| `server/src/lib/auth-utils.test.ts` | pglite fixture hand-writes the `sites` CREATE TABLE; needs our two heatmap columns or 27 tests fail |
| `client/src/app/[site]/components/Sidebar/Sidebar.tsx` | Heatmaps nav item |
| `client/src/components/SiteSettings/TrackingTab.tsx` | heatmap enable toggle UI |
| `client/src/lib/filterGroups.ts`, `client/src/app/[site]/components/SubHeader/Export/exportCsv.ts` | smaller touches |

Deploy default image tag is `heatmap`; health check verifies `heatmap_events` / `heatmap_snapshots` tables exist.

Drizzle migration: our heatmap columns live in `server/drizzle/0014_add_heatmaps.sql` (idempotent
`IF NOT EXISTS`). It has been renumbered twice by upstream collisions: `0009` → `0010` (v2.7.0) →
`0014` (v2.8.0, which shipped its own 0010–0013). The renumber recipe, each time:

1. Take upstream's colliding snapshot/journal (`git checkout --theirs meta/00NN_snapshot.json`,
   `git show vX.Y.Z:server/drizzle/meta/_journal.json > .../_journal.json`).
2. `rm` our old `.sql`, then `cd server && npm run db:generate` (offline — diffs `schema.ts`
   against the newest snapshot; it should emit ONLY our two `sites` columns).
3. Rename the generated file to `00NN_add_heatmaps.sql`, re-add `IF NOT EXISTS` to both statements,
   and `sed` the generated tag in `meta/_journal.json` to `00NN_add_heatmaps`.

Safe on the prod DB either way — every statement is idempotent.

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
| `client/src/lib/featureOverrides.ts` (our file) + `client/src/app/[site]/components/Sidebar/Sidebar.tsx` + `client/src/app/[site]/main/page.tsx` | Unlock features upstream gates behind `IS_CLOUD` (Pages, Performance, Bots, Search Console) on self-host. The two upstream files swap `{IS_CLOUD && …}` for `{featureEnabled.x && …}`. **On merge: upstream may add new `IS_CLOUD` gates — re-check** with `git diff vOLD..vNEW -- client/src \| grep '^+.*IS_CLOUD'`. | — |
| `client/src/app/[site]/components/Sidebar/Sidebar.tsx` | v2.8.0 reinstated the **Query + Dashboards** nav behind `!IS_CLOUD`, i.e. visible on self-host — reversing the hide we retired at v2.7.0. Now gated on `featureEnabled.queryAndDashboards`, which defaults to **hidden**; set `NEXT_PUBLIC_SHOW_QUERY_DASHBOARDS="true"` to take upstream's behavior. | v2.8.0 merge |
| `server/src/analytics-script/index.ts` | `document.currentScript` fallback — FlyingPress/delay-JS plugins re-inject the tag and break it, so we locate our script by `data-site-id` / `src*="/script.js"`. | — |
| `server/src/analytics-script/config.ts` | Accept `data-src` as well as `src` (delay-JS plugins move the real URL there), plus the heatmap config passthrough. | — |
| `server/src/analytics-script/types.ts` | `enableHeatmaps`/`heatmapSampleRate` on `ScriptConfig`, declared **optional** — required fields break every upstream test that builds a `ScriptConfig` literal. | v2.8.0 merge |
| `server/src/api/heatmap/recordHeatmap.ts` (our file) | v2.8.0 deleted `siteConfig.isIPExcluded`/`isCountryExcluded`; now calls `decideSiteExclusion(...)` like `trackEvent` does (also gains path/hostname/UA/ASN exclusions). | v2.8.0 merge |
| `server/src/api/analytics/goals/getGoalSessions.ts` | Enrich converted sessions with user traits (select `identified_user_id`, call `enrichWithTraits`) so names/emails resolve on the Goals card. | `f98b8394` |
| `server/src/api/analytics/goals/getGoalSessions.ts` | Prior: default `page` param to 1. | upstream PR #940 (already merged) |
| `client/src/lib/heatmap/renderHeatmap.ts` | Heatmap rendering tweaks (overlay opacity, click rendering). | Heatmaps rebuild work |
| `server/src/api/heatmap/getClickHeatmap.ts` | Click heatmap query changes. | Heatmaps rebuild work |
| `server/src/services/tracker/utils.ts` | `clearSelfReferrer` now strips `www.` and treats subdomain relationships both ways as internal (e.g. `app.decorai.io` ↔ `decorai.io`), so cross-subdomain self-referrals don't pollute the Referrers list. | `// CUSTOM` |
| ~~Sidebar nav component~~ | ~~Hide **Query** and **Dashboards** nav items.~~ Upstream v2.7.0 comments the block out itself — our edit is no longer needed; we carry upstream's version. | `0736bbf0`, retired in v2.7.0 merge |
| Heatmaps UI (Click tab) | Active-pill styling, transparent caret split-button, adjustable overlay opacity slider. | `77e22bc0`, `e9b54bc9`, `5f063935` |

> Tagging feature was upstream PR #941 (merged), not a local customization.

## Notes

### Building the client locally (v2.8.0+)
`client/npm run build` fails with `Module not found: Can't resolve '@rybbit/shared'` if that package
is left as npm's `file:../shared` **symlink** — Turbopack won't follow a link escaping `client/`.
It only started mattering in v2.8.0, the first release where the client imports a *value* (not just
types) from the shared package. Upstream's `client/Dockerfile` already materializes it, so
`./deploy.sh` is unaffected; to build locally do what the Dockerfile does:

```bash
cd shared && npm run build && cd ../client
rm -rf node_modules/@rybbit/shared && mkdir -p node_modules/@rybbit/shared
cp -r ../shared/package.json ../shared/dist node_modules/@rybbit/shared/
```

Do **not** "fix" this with `turbopack.root`/`outputFileTracingRoot` in `next.config.ts` — that
re-homes `output: "standalone"` to `.next/standalone/client/server.js`, and the Dockerfile runner
copies `.next/standalone` expecting `server.js` at the root. The container would fail to boot.

### Message catalogs
A local `client` build runs next-intl extraction and **rewrites all 12 `client/messages/*.json`** in a
non-alphabetical order. Upstream commits them default-sorted, so don't commit that churn —
`git checkout -- client/messages/` after building. Our divergence there should stay exactly 36 added
keys (heatmap + Mailbo strings) per locale.

- Keep this table current. When resolving a merge conflict, this is the list of things to protect.
- For anything here, prefer refactoring the custom logic into a `custom/` helper so the in-place
  edit shrinks to a one-line call over time.
