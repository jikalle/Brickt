#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG_DIR="${LOG_DIR:-/tmp/homeshare-ops}"
ALERT_SCHEDULE="${ALERT_SCHEDULE:-*/2 * * * *}"
RECONCILE_SCHEDULE="${RECONCILE_SCHEDULE:-*/5 * * * *}"
APPLY=false

if [[ "${1:-}" == "--apply" ]]; then
  APPLY=true
fi

mkdir -p "$LOG_DIR"

BEGIN_MARKER="# BEGIN HOMESHARE_OPS_JOBS"
END_MARKER="# END HOMESHARE_OPS_JOBS"

CRON_BLOCK=$(cat <<EOF
$BEGIN_MARKER
$ALERT_SCHEDULE cd $ROOT_DIR && flock -n /tmp/homeshare-intents-alert.lock pnpm --filter @homeshare/backend intents:alert >> $LOG_DIR/intents-alert.log 2>&1
$RECONCILE_SCHEDULE cd $ROOT_DIR && flock -n /tmp/homeshare-intents-reconcile.lock pnpm --filter @homeshare/backend reconcile:intents >> $LOG_DIR/intents-reconcile.log 2>&1
$END_MARKER
EOF
)

EXISTING_CRON="$(crontab -l 2>/dev/null || true)"
SANITIZED_CRON="$(printf '%s\n' "$EXISTING_CRON" | sed "/$BEGIN_MARKER/,/$END_MARKER/d")"
NEW_CRON="$(printf '%s\n%s\n' "$SANITIZED_CRON" "$CRON_BLOCK" | sed '/^$/N;/^\n$/D')"

echo "Root: $ROOT_DIR"
echo "Logs: $LOG_DIR"
echo
echo "Planned cron block:"
echo "-------------------"
echo "$CRON_BLOCK"
echo "-------------------"

if [[ "$APPLY" == "true" ]]; then
  printf '%s\n' "$NEW_CRON" | crontab -
  echo "Cron updated successfully."
else
  echo "Dry run only. Re-run with --apply to install."
fi

