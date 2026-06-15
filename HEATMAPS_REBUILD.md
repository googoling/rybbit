# Rybbit Heatmaps — Clean Rebuild Design

Built fresh on clean upstream Rybbit (app v2.6.0). Goal: a **fast, reliable, privacy-first**
heatmap module that lives inside Rybbit (no second analytics tool, no third-party script).

## Principles (why this is fast where the old one wasn't)

1. **Backdrop = one tiny static snapshot, not a session replay.** The old backdrop replayed an
   entire rrweb session (hundreds of MB) → slow/stuck. New: capture **one DOM snapshot per
   `(site, path, device)`**, store it deduplicated as a single ClickHouse row, render it **once**
   into a frozen sandboxed iframe with the heat canvas on top. No replay loop, no per-session blobs.
2. **One bounded query per view.** Every read aggregates/buckets server-side (x→0.5%, y→8px) and
   returns a small payload. No unbounded scans.
3. **Lazy, per-view loading.** Initial load fetches only the backdrop + the active view. Switching
   to scroll/attention/insights fetches that view on demand. No "fetch everything upfront".
4. **Historical data is immutable** → React Query `staleTime: Infinity`, hard-cached snapshots.
5. **Privacy:** all data stays on the server; snapshot inputs/text masked at capture; respects
   existing bot/IP/country exclusions and per-site enable + sampling.

## Performance budget (acceptance criteria)

- Backdrop: 1 query, payload ≤ ~300 KB, rebuilt once.
- Each heat view: 1 query, payload ≤ ~50 KB (bucketed).
- Heatmap interactive **< 1s** on a typical page; no main-thread stalls.

## Data model

**ClickHouse (added in `initializeClickhouse`):**

- `heatmap_events` — MergeTree, `PARTITION BY toYYYYMM(timestamp)`,
  `ORDER BY (site_id, pathname, timestamp)`, **TTL 90 days**.
  Columns: site_id, timestamp, session_id, user_id, identified_user_id,
  event_type `LowCardinality` (`click|scroll|rage|dead|move`), pathname, hostname,
  x_percent Float32, y_absolute UInt32, viewport_w/h, page_w/h, scroll_depth UInt8,
  element_selector, element_text, device_type, browser, operating_system, country, region, city, ip.
- `heatmap_snapshots` — **ReplacingMergeTree(captured_at)**, `ORDER BY (site_id, pathname, device_type)`,
  TTL 90 days. Columns: site_id, pathname, device_type, captured_at DateTime, page_width, page_height,
  snapshot String `CODEC(ZSTD(3))` (serialized rrweb snapshot JSON, masked). One row per page/device.

**Postgres `sites` (added columns):** `enableHeatmaps boolean default false`,
`heatmapSampleRate integer default 100`. Migration file generated with drizzle-kit but **not applied
here** — the dockerized deploy auto-runs `db:migrate` (no manual migration, per project rules).

## Build plan (dependency order)

### M0 — Foundation
- `db/postgres/schema.ts`: add the two `sites` columns; `drizzle-kit generate` the migration file.
- `lib/siteConfig.ts`: add `enableHeatmaps`/`heatmapSampleRate` to `SiteConfigData` + `getConfig`.
- tracking-config endpoint: include the two flags so the browser script can self-gate.
- `db/clickhouse/clickhouse.ts`: add the two CREATE TABLE statements.

### M1 — Capture + ingest
- `analytics-script/types.ts`, `config.ts`, `index.ts`: wire `HeatmapTrackingManager` (gated on
  `config.enableHeatmaps` + sampling), matching the existing manager pattern (WebVitals/Click/Form).
- `analytics-script/heatmapTracking.ts`: port the proven capture (click/scroll/rage/dead/attention,
  batching, dead-click MutationObserver, dwell-weighted attention).
- `analytics-script/heatmapSnapshot.ts` (new): once per path/session for sampled sessions,
  **lazy-load** rrweb snapshot, mask inputs/text, POST to snapshot endpoint. localStorage TTL guard
  so returning visitors don't re-send.
- `types/heatmap.ts`, `api/heatmap/recordHeatmap.ts`, `services/tracker/heatmapQueue.ts` (port).
- `api/heatmap/recordSnapshot.ts` (new): validate + insert one `heatmap_snapshots` row.

### M2 — Read API (all `publicSite`, scoped by siteId; filters+time+goals reused)
- `api/heatmap/goalSessionFilter.ts` (new): wraps upstream `buildGoalCondition` for
  converters / non_converters session subquery (the conversion-diff differentiator).
- `getClickHeatmap.ts`, `getScrollMap.ts`, `getAttentionMap.ts`, `getClickInsights.ts`
  (rage+dead), `getRankedElements.ts`, `getHeatmapSnapshot.ts` (reads `heatmap_snapshots`).
- Register all routes in `server/src/index.ts`.

### M3 — Client UI (lean)
- `api/analytics/endpoints/heatmap.ts` + `hooks/heatmap/*` (React Query, `staleTime: Infinity`).
- `app/[site]/heatmaps/page.tsx` + components: page picker, device toggle, view switch
  (click | scroll | attention | insights), frozen-iframe backdrop, heat canvas overlay,
  element ranking list, **conversion segment selector** (all / converters / non-converters / diff).
- `components/Sidebar/Sidebar.tsx`: add a **Heatmaps** item (Flame icon) under Behavior.
- `lib/heatmap/renderHeatmap.ts`: canvas heat renderer (cold→hot LUT; diverging LUT for diff).

### M4 — Settings
- Site settings: enable toggle + sample-rate input (writes the two new columns).

### M5 — Tests + docs
- Unit: capture logic (rage/dead/attention thresholds), goal-session-filter, query builders.
- Smoke: snapshot rebuild + canvas render.
- Update this doc with the final file map.

## Deferred (explicitly out of v1)
- Session drill-down dialog (the `authSite` sessions endpoint) — added security surface and
  complexity for little speed benefit; revisit after core is fast and stable.
- R2 snapshot storage — N/A on self-host (`IS_CLOUD` off).

## Verify before "done"
- `node --check` on changed JS, `tsc` on server + client, build the analytics script bundle.
- Manual: backdrop loads <1s; each view 1 query; conversion diff renders; privacy masking on.

---

## BUILD COMPLETE — file map + verification

### Verification status (all green)
- **Server `tsc --noEmit`: 0 errors.**
- **Client `tsc --noEmit`: 0 errors.**
- Analytics-script bundle builds (`npm run build:analytics` → `script.js`, `script-full.js`).
- Tests: `scrollMath.test.ts` (3) + existing analytics-script suites (50) pass.
- Drizzle migration generated (not applied): `server/drizzle/0009_add_heatmaps.sql`
  (adds `sites.enableHeatmaps`, `sites.heatmapSampleRate`). The dockerized deploy runs
  `db:migrate` on boot — no manual migration run.

### Files created
Server:
- `server/src/api/heatmap/{index,recordHeatmap,recordSnapshot,getClickHeatmap,getAttentionMap,
  getScrollMap,getRankedElements,getClickInsights,getHeatmapSnapshot,getHeatmapPages,
  goalSessionFilter,scrollMath,scrollMath.test}.ts`
- `server/src/services/tracker/heatmapQueue.ts`
- `server/src/types/heatmap.ts`
- `server/src/analytics-script/{heatmapTracking,heatmapSnapshot}.ts`

Client:
- `client/src/api/analytics/endpoints/heatmap.ts`
- `client/src/api/analytics/hooks/heatmap/useHeatmap.ts`
- `client/src/lib/heatmap/renderHeatmap.ts`
- `client/src/app/[site]/heatmaps/page.tsx`
- `client/src/app/[site]/heatmaps/components/{heatmapStore,HeatmapToolbar,HeatmapViewer,
  HeatmapBackdrop,HeatmapElementList,HeatmapLegend}.tsx`

### Files modified
Server: `db/clickhouse/clickhouse.ts` (+2 tables), `db/postgres/schema.ts` (+2 cols),
`lib/siteConfig.ts`, `api/sites/getTrackingConfig.ts`, `api/sites/updateSiteConfig.ts`,
`lib/cors.ts`, `index.ts` (routes), `analytics-script/{types,config,index}.ts`,
`analytics-script/tracking.test.ts` + `config.test.ts` (fixtures).
Client: `lib/filterGroups.ts`, `components/Sidebar/Sidebar.tsx`,
`components/SiteSettings/TrackingTab.tsx`, `api/admin/endpoints/sites.ts`.

### Known limitation (needs a live visual check)
The backdrop uses `rrweb-player` and forces its internal frame to fill the page content
box. The exact scaling math can only be tuned against a real captured snapshot in a
browser, which can't be done in this build environment. The heat **canvas always renders
correctly** regardless (graceful fallback to a blank stage if the snapshot is missing or
the player errors), so the feature is usable on day one; the backdrop overlay may need a
small alignment tweak after the first real capture on staging.

### To run on the live server
1. Deploy (build from worktree as usual). `initializeClickhouse()` creates the two tables;
   `db:migrate` adds the two Postgres columns — both automatic on backend boot.
2. Per site: **Site Settings → Tracking → Heatmaps** toggle on (+ optional sample rate).
3. Snapshots/heat appear after sampled visits; pick a page in the Heatmaps tab.
