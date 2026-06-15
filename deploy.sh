#!/usr/bin/env bash
# Fast deploy of this repo to the live self-host server (ssh: faridul).
#   ./deploy.sh [tag]      (default tag: heatmap)
# Builds client+backend images on the server from this exact source, points the
# live stack's override at the new tag, rolls only backend+client (DB/caddy untouched),
# then health-checks. Re-runs are fast: rsync is incremental + Docker layer cache.
set -euo pipefail

TAG="${1:-heatmap}"
HOST="faridul"
LOCAL_REPO="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="/home/faridul/rybbit-hm-build"
STACK_DIR="/home/faridul/rybbit"

echo "▶ [1/5] Sync source → $HOST:$BUILD_DIR (incremental)"
ssh "$HOST" "mkdir -p $BUILD_DIR"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.next' \
  --exclude 'dist' --exclude '*.log' --exclude '.env' \
  "$LOCAL_REPO/" "$HOST:$BUILD_DIR/"

echo "▶ [2/5] Build images IMAGE_TAG=$TAG on server (uses live .env for NEXT_PUBLIC_* build args)"
ssh "$HOST" "cp $STACK_DIR/.env $BUILD_DIR/.env && cd $BUILD_DIR && IMAGE_TAG=$TAG docker compose build client backend"

echo "▶ [3/5] Point live override at :$TAG (in-place tag bump; preserves env block e.g. GOOGLE_*)"
ssh "$HOST" "cp $STACK_DIR/docker-compose.override.yml $STACK_DIR/docker-compose.override.yml.bak-$(date +%s) 2>/dev/null || true"
ssh "$HOST" "F=$STACK_DIR/docker-compose.override.yml
if [ -f \"\$F\" ] && grep -q 'rybbit-client' \"\$F\"; then
  sed -i -E 's#(rybbit-client:).*#\\1$TAG#; s#(rybbit-backend:).*#\\1$TAG#' \"\$F\"
else
  printf 'services:\\n  client:\\n    image: ghcr.io/rybbit-io/rybbit-client:%s\\n  backend:\\n    image: ghcr.io/rybbit-io/rybbit-backend:%s\\n' '$TAG' '$TAG' > \"\$F\"
fi"

echo "▶ [4/5] Roll backend + client (DB + caddy untouched)"
ssh "$HOST" "cd $STACK_DIR && docker compose up -d --no-deps backend client"

echo "▶ [5/5] Health check"
ssh "$HOST" 'bash -s' <<'HC'
cd /home/faridul/rybbit
ok=""
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002 || true)
  if [ "$code" = "200" ]; then ok=1; echo "  client http=200 ✓"; break; fi
  sleep 3
done
[ -z "$ok" ] && echo "  ⚠ client did not return 200 in time"
docker compose ps --format '{{.Service}} {{.Image}} {{.Status}}' | grep -E 'backend|client' | sed 's/^/  /'
echo "  heatmap_events EXISTS=$(docker compose exec -T clickhouse clickhouse-client --database analytics -q "EXISTS TABLE heatmap_events" 2>/dev/null)"
echo "  heatmap_snapshots EXISTS=$(docker compose exec -T clickhouse clickhouse-client --database analytics -q "EXISTS TABLE heatmap_snapshots" 2>/dev/null)"
HC
echo "✔ Deploy complete → :$TAG  (rollback: restore a docker-compose.override.yml.bak-* then 'docker compose up -d --no-deps backend client')"
