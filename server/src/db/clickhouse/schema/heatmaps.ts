import { clickhouse } from "../client.js";
import { execClickhouseInitStep } from "../initUtils.js";

async function migrateSnapshotsTable() {
  // heatmap_snapshots v1 had no hostname column so its ORDER BY can't scope snapshots per
  // domain. Drop it so the v2 CREATE TABLE runs fresh — snapshots regenerate from real visits.
  try {
    const result = await clickhouse.query({
      query: `SELECT count() AS c FROM system.columns WHERE database = currentDatabase() AND table = 'heatmap_snapshots' AND name = 'hostname'`,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ c: string }>;
    if (rows[0]?.c === "0") {
      await clickhouse.exec({ query: "DROP TABLE IF EXISTS heatmap_snapshots" });
    }
  } catch {
    // Best-effort — if check fails, leave the table as-is.
  }

  // Extend ORDER BY to include captured_at so multiple snapshots per page are retained.
  try {
    const result = await clickhouse.query({
      query: `SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = 'heatmap_snapshots'`,
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ sorting_key: string }>;
    if (rows.length > 0 && !rows[0].sorting_key.includes("captured_at")) {
      await clickhouse.exec({
        query: `ALTER TABLE heatmap_snapshots MODIFY ORDER BY (site_id, hostname, pathname, device_type, captured_at)`,
      });
    }
  } catch {
    // Best-effort — if this fails, snapshot picker shows only one entry per page.
  }
}

export async function initializeHeatmapTables() {
  // Heatmap events (click/scroll/rage/dead/move). 90-day retention.
  await execClickhouseInitStep(
    "create heatmap_events table",
    `
      CREATE TABLE IF NOT EXISTS heatmap_events (
        site_id UInt16,
        timestamp DateTime,
        session_id String DEFAULT '',
        user_id String,
        identified_user_id String DEFAULT '',
        event_type LowCardinality(String) DEFAULT 'click', /* 'click' | 'scroll' | 'rage' | 'dead' | 'move' */
        pathname String,
        hostname String DEFAULT '',
        x_percent Float32 DEFAULT 0, /* X as % of page content width [0..100] */
        y_absolute UInt32 DEFAULT 0, /* Y in document pixels (absolute, includes scroll) */
        viewport_width UInt16 DEFAULT 0,
        viewport_height UInt16 DEFAULT 0,
        page_width UInt16 DEFAULT 0,
        page_height UInt32 DEFAULT 0,
        scroll_depth UInt8 DEFAULT 0, /* max scroll depth % at event time [0..100] */
        element_selector String DEFAULT '',
        element_text String DEFAULT '',
        device_type LowCardinality(String) DEFAULT '',
        browser LowCardinality(String) DEFAULT '',
        operating_system LowCardinality(String) DEFAULT '',
        country LowCardinality(FixedString(2)) DEFAULT '',
        region LowCardinality(String) DEFAULT '',
        city String DEFAULT '',
        ip Nullable(String)
      )
      ENGINE = MergeTree()
      PARTITION BY toYYYYMM(timestamp)
      ORDER BY (site_id, pathname, timestamp)
      TTL toDateTime(timestamp) + INTERVAL 90 DAY
      `
  );

  await migrateSnapshotsTable();

  // One frozen DOM snapshot per (site, hostname, path, device) for the heatmap backdrop. Latest wins.
  await execClickhouseInitStep(
    "create heatmap_snapshots table",
    `
      CREATE TABLE IF NOT EXISTS heatmap_snapshots (
        site_id UInt16,
        hostname LowCardinality(String) DEFAULT '',
        pathname String,
        device_type LowCardinality(String) DEFAULT '',
        captured_at DateTime DEFAULT now(),
        page_width UInt16 DEFAULT 0,
        page_height UInt32 DEFAULT 0,
        viewport_width UInt16 DEFAULT 0,
        viewport_height UInt16 DEFAULT 0,
        snapshot String CODEC(ZSTD(3))
      )
      ENGINE = ReplacingMergeTree(captured_at)
      PARTITION BY toYYYYMM(captured_at)
      ORDER BY (site_id, hostname, pathname, device_type)
      TTL toDateTime(captured_at) + INTERVAL 90 DAY
      `
  );
}
