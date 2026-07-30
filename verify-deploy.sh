#!/usr/bin/env bash
# Post-deploy production verification for the live self-host stack.
#
#   ./verify-deploy.sh
#
# Every check that actually caught something (or would have) during the v2.8.0 upgrade.
# The important ones are the LAST three: a green health check only proves the process boots —
# it does not prove OUR customizations survived the build, or that data still flows.
# Exits non-zero if any check fails.
set -uo pipefail

HOST="${DEPLOY_SSH_HOST:-faridul}"
STACK="/home/faridul/rybbit"
URL="${DEPLOY_URL:-https://analytics.faridul.com}"

fails=0
pass() { printf "  ✓ %s\n" "$1"; }
fail() { printf "  ✗ %s\n" "$1"; fails=$((fails + 1)); }

echo "▶ 1. Public endpoints"
for p in "" "/api/health"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL$p")
  [ "$code" = "200" ] && pass "$URL$p -> 200" || fail "$URL$p -> $code (expected 200)"
done

echo "▶ 2. Containers"
ps_out=$(ssh "$HOST" "cd $STACK && docker compose ps --format '{{.Service}} {{.Status}}'")
echo "$ps_out" | sed 's/^/    /'
echo "$ps_out" | grep -q '^backend Up' && pass "backend up" || fail "backend NOT up"
echo "$ps_out" | grep -q '^client Up'  && pass "client up"  || fail "client NOT up"

echo "▶ 3. Postgres migrations (entrypoint runs db:migrate on every boot)"
migerr=$(ssh "$HOST" "cd $STACK && docker compose logs backend --since 15m 2>&1 | grep -iE 'migration failed|error: .*migrat' | head -3")
[ -z "$migerr" ] && pass "no migration errors in recent logs" || fail "migration errors: $migerr"
count=$(ssh "$HOST" "cd $STACK && docker compose exec -T postgres psql -U frog -d analytics -t -c 'SELECT count(*) FROM drizzle.__drizzle_migrations;'" | tr -d ' \r\n')
pass "migrations applied: $count"

echo "▶ 4. OUR Postgres columns survived the merge"
cols=$(ssh "$HOST" "cd $STACK && docker compose exec -T postgres psql -U frog -d analytics -t -c \"SELECT column_name FROM information_schema.columns WHERE table_name='sites' AND column_name IN ('enableHeatmaps','heatmapSampleRate');\"" | tr -d ' \r' | grep -c .)
[ "$cols" = "2" ] && pass "heatmap site columns present (2/2)" || fail "heatmap site columns MISSING ($cols/2)"

echo "▶ 5. OUR ClickHouse tables + data"
for t in heatmap_events heatmap_snapshots; do
  ex=$(ssh "$HOST" "cd $STACK && docker compose exec -T clickhouse clickhouse-client --database analytics -q 'EXISTS TABLE $t'" | tr -d ' \r\n')
  n=$(ssh "$HOST" "cd $STACK && docker compose exec -T clickhouse clickhouse-client --database analytics -q 'SELECT count() FROM $t'" | tr -d ' \r\n')
  [ "$ex" = "1" ] && pass "$t exists (rows=$n)" || fail "$t MISSING"
done

echo "▶ 6. OUR routes registered (403/401 = registered+guarded, 404 = LOST IN MERGE)"
for p in /api/sites/1/heatmap/pages /api/sites/1/heatmap/clicks /api/sites/1/heatmap/scroll \
         /api/sites/1/heatmap/attention /api/sites/1/heatmap/elements /api/sites/1/heatmap/insights \
         /api/sites/1/heatmap/snapshot /api/sites/1/heatmap/snapshots \
         /api/mailbo/config/1 /api/sites/1/goals; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$URL$p")
  case "$code" in
    401|403) pass "$p -> $code" ;;
    404)     fail "$p -> 404 — ROUTE LOST" ;;
    *)       fail "$p -> $code (unexpected)" ;;
  esac
done

echo "▶ 7. OUR tracking-script customizations in the served bundle"
js=$(curl -s "$URL/api/script.js")
[ -n "$js" ] && pass "script.js served ($(printf '%s' "$js" | wc -c | tr -d ' ') bytes)" || fail "script.js empty"
printf '%s' "$js" | grep -q heatmap        && pass "heatmap tracking present"       || fail "heatmap tracking MISSING"
printf '%s' "$js" | grep -q 'data-src'     && pass "data-src fallback present"      || fail "data-src fallback MISSING"
printf '%s' "$js" | grep -q 'data-site-id' && pass "data-site-id fallback present"  || fail "data-site-id fallback MISSING"

echo "▶ 8. Live ingestion (the real smoke test — traffic flowing through the NEW build)"
ev=$(ssh "$HOST" "cd $STACK && docker compose exec -T clickhouse clickhouse-client --database analytics -q \"SELECT countIf(timestamp > now() - INTERVAL 15 MINUTE) FROM events\"" | tr -d ' \r\n')
hm=$(ssh "$HOST" "cd $STACK && docker compose exec -T clickhouse clickhouse-client --database analytics -q \"SELECT countIf(timestamp > now() - INTERVAL 15 MINUTE) FROM heatmap_events\"" | tr -d ' \r\n')
[ "${ev:-0}" -gt 0 ] 2>/dev/null && pass "events ingested last 15m: $ev" || fail "NO events in last 15m (low traffic? re-check before panicking)"
[ "${hm:-0}" -gt 0 ] 2>/dev/null && pass "heatmap events last 15m: $hm" || fail "NO heatmap events in last 15m"

echo "▶ 9. Rollback assets"
imgs=$(ssh "$HOST" "docker images --format '{{.Repository}}:{{.Tag}}' | grep -c 'pre-v2' || true")
[ "${imgs:-0}" -gt 0 ] && pass "pre-v* rollback images present ($imgs)" || fail "NO pre-v* rollback images — tag them BEFORE the next deploy"

echo
if [ "$fails" -eq 0 ]; then
  echo "✔ all checks passed"
else
  echo "✗ $fails check(s) failed"
  echo "  rollback: ssh $HOST 'cd $STACK && sed -i \"s/:heatmap/:pre-vXXX/\" docker-compose.override.yml && docker compose up -d --no-deps backend client'"
fi
exit "$fails"
