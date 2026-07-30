#!/usr/bin/env bash
# DecorAI user journey — cross-session funnel for site_id=3
#
# Phase 1 (Awareness)    — loose reach: how many unique users ever did this
# Phase 2 (Activation)   — strict from signup: of signed-up users, what % activated
#
# Run: ./decorai/journey.sh [days]
# Default window: all time.  Example: ./decorai/journey.sh 30
set -euo pipefail

SITE=3
SSH_HOST="${SSH_HOST:-faridul}"
CONTAINER="${CH_CONTAINER:-clickhouse}"
DAYS="${1:-}"

if [[ -n "$DAYS" ]]; then
  WHERE_TIME="AND timestamp > now() - INTERVAL ${DAYS} DAY"
  WINDOW="${DAYS} days"
else
  WHERE_TIME=""
  WINDOW="all time"
fi

# ── Phase 1: awareness (loose — any order, any time) ─────────────────────────
SQL_P1=$(cat <<SQL
SELECT
  countIf(event_name = 'pricing_viewed')    AS pricing,
  countIf(event_name = 'auth_panel_opened') AS auth,
  countIf(event_name = 'signup_verified')   AS signup
FROM (
  SELECT
    if(identified_user_id != '', identified_user_id, user_id) AS uid,
    event_name
  FROM events
  WHERE site_id = ${SITE}
    AND type = 'custom_event'
    AND event_name IN ('pricing_viewed','auth_panel_opened','signup_verified')
    ${WHERE_TIME}
  GROUP BY uid, event_name
)
FORMAT TabSeparated
SQL
)

# ── Phase 2: activation (strict from signup) ──────────────────────────────────
SQL_P2=$(cat <<SQL
WITH signup_users AS (
  SELECT
    if(identified_user_id != '', identified_user_id, user_id) AS uid,
    min(timestamp) AS signed_up_at
  FROM events
  WHERE site_id = ${SITE}
    AND type = 'custom_event'
    AND event_name = 'signup_verified'
    ${WHERE_TIME}
  GROUP BY uid
),
post_signup AS (
  SELECT
    if(e.identified_user_id != '', e.identified_user_id, e.user_id) AS uid,
    e.event_name,
    min(e.timestamp) AS first_at
  FROM events e
  INNER JOIN signup_users s
    ON if(e.identified_user_id != '', e.identified_user_id, e.user_id) = s.uid
       AND e.timestamp >= s.signed_up_at
  WHERE e.site_id = ${SITE}
    AND e.type = 'custom_event'
    AND e.event_name IN ('design_generated','checkout_started','checkout_completed')
  GROUP BY uid, e.event_name
),
pivot AS (
  SELECT
    s.uid,
    s.signed_up_at,
    minIf(p.first_at, p.event_name = 'design_generated')   AS t_design,
    minIf(p.first_at, p.event_name = 'checkout_started')   AS t_checkout,
    minIf(p.first_at, p.event_name = 'checkout_completed') AS t_paid
  FROM signup_users s
  LEFT JOIN post_signup p ON s.uid = p.uid
  GROUP BY s.uid, s.signed_up_at
)
SELECT
  count()                                                              AS total_signups,
  countIf(t_design   > '2020-01-01')                                  AS designed,
  countIf(t_checkout > '2020-01-01' AND t_checkout >= t_design)       AS checkout_started,
  countIf(t_paid     > '2020-01-01' AND t_paid     >= t_checkout)     AS purchased
FROM pivot
FORMAT TabSeparated
SQL
)

R1=$(ssh "$SSH_HOST" "docker exec $CONTAINER clickhouse-client --database analytics -q \"$SQL_P1\"")
R2=$(ssh "$SSH_HOST" "docker exec $CONTAINER clickhouse-client --database analytics -q \"$SQL_P2\"")

# Phase 1 values
p_pricing=$(echo "$R1" | awk '{print $1}')
p_auth=$(echo    "$R1" | awk '{print $2}')
p_signup=$(echo  "$R1" | awk '{print $3}')

# Phase 2 values
a_signup=$(echo   "$R2" | awk '{print $1}')
a_design=$(echo   "$R2" | awk '{print $2}')
a_checkout=$(echo "$R2" | awk '{print $3}')
a_paid=$(echo     "$R2" | awk '{print $4}')

pct() {
  local n=$1 d=$2
  [[ "$d" -eq 0 ]] && { echo "   —  "; return; }
  awk "BEGIN{printf \"%6.1f%%\", ($n/$d)*100}"
}

hr="  ───────────────────────────────────────────────────────────"

echo ""
echo "  DecorAI User Journey  (${WINDOW})"
echo "$hr"

echo ""
echo "  Phase 1 — Awareness  (unique users who ever reached this step)"
echo "$hr"
printf "  %-4s  %-28s  %7s  %9s\n" "Step" "Event" "Users" "drop-off"
echo "$hr"
printf "  %-4s  %-28s  %7s  %9s\n" "1" "pricing_viewed"    "$p_pricing" "    base"
printf "  %-4s  %-28s  %7s  %9s\n" "2" "auth_panel_opened" "$p_auth"    "$(pct $p_auth    $p_pricing)"
printf "  %-4s  %-28s  %7s  %9s\n" "3" "signup_verified"   "$p_signup"  "$(pct $p_signup  $p_pricing)"
echo "$hr"

echo ""
echo "  Phase 2 — Activation  (strict: each step must occur after the previous)"
echo "$hr"
printf "  %-4s  %-28s  %7s  %9s  %9s\n" "Step" "Event" "Users" "vs prev" "vs signup"
echo "$hr"
printf "  %-4s  %-28s  %7s  %9s  %9s\n" "3" "signup_verified"    "$a_signup"   "    base" "  100%"
printf "  %-4s  %-28s  %7s  %9s  %9s\n" "4" "design_generated"   "$a_design"   "$(pct $a_design   $a_signup)"  "$(pct $a_design   $a_signup)"
printf "  %-4s  %-28s  %7s  %9s  %9s\n" "5" "checkout_started"   "$a_checkout" "$(pct $a_checkout $a_design)"  "$(pct $a_checkout $a_signup)"
printf "  %-4s  %-28s  %7s  %9s  %9s\n" "6" "checkout_completed" "$a_paid"     "$(pct $a_paid     $a_checkout)" "$(pct $a_paid    $a_signup)"
echo "$hr"

echo ""
echo "  User key : identified_user_id when known, device fingerprint otherwise."
echo "  Phase 1  : loose reach (any order, total unique users per step)."
echo "  Phase 2  : strict ordering from signup (cross-session)."
echo "  Window   : ${WINDOW}   |   Run: ./decorai/journey.sh [days]"
echo ""
