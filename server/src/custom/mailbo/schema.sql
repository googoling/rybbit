-- Mailbo integration custom tables. Apply MANUALLY (fork rule: never auto-run migrations):
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f - < server/src/custom/mailbo/schema.sql
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS mailbo_integration_config (
  site_id     integer PRIMARY KEY,
  api_key     text        NOT NULL DEFAULT '',
  enabled     boolean     NOT NULL DEFAULT false,
  base_url    text        NOT NULL DEFAULT 'https://mailbo.io/api/v1',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mailbo_sync_state (
  site_id          integer     NOT NULL,
  email            text        NOT NULL,
  sent_milestones  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, email)
);
