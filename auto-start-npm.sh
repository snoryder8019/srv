#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# auto-start-npm.sh — boot every srv tmux service with a CLEAN restart.
# For each service it kills any stale session(s) AND frees the port, then starts
# one fresh session under the bare "<name>" (matching service-watchdog.json). Shares its restart logic with
# /srv/restart-service.sh via /srv/lib-restart.sh (single source of truth).
# ─────────────────────────────────────────────────────────────────────────────

CONFIG_FILE="/srv/auto-start-npm.json"
LOG_FILE="/srv/auto-start-npm.log"
LIB="/srv/lib-restart.sh"

# Mirror all output to the log (fresh each run) and the console.
exec > >(tee "$LOG_FILE") 2>&1

echo "========================================"
echo "Auto-start script started at $(date)"
echo "========================================"

if ! command -v jq &> /dev/null;    then echo "ERROR: jq is not installed (apt-get install jq)";      exit 1; fi
if ! command -v fuser &> /dev/null; then echo "ERROR: fuser is not installed (apt-get install psmisc)"; exit 1; fi
if [ ! -f "$CONFIG_FILE" ];         then echo "ERROR: Config file $CONFIG_FILE not found!";            exit 1; fi
if [ ! -f "$LIB" ];                 then echo "ERROR: $LIB not found!";                                 exit 1; fi

# shellcheck source=/srv/lib-restart.sh
source "$LIB"

# ── JSON-managed services: /srv/<key> running <cmd>, port from the config ──────
echo ""
echo "Starting JSON-managed services (clean restart each)…"
echo ""
while IFS=$'\t' read -r name cmd port; do
  name=$(echo "$name" | xargs)
  clean_restart "$name" "$name" "/srv/$name" "$cmd" "$port"
done < <(jq -r 'to_entries[] | "\(.key)\t\(.value.cmd)\t\(.value.port // "")"' "$CONFIG_FILE")

# ── Special-case services (relocated dirs / custom session names) ─────────────
# Defined once in lib-restart.sh (RESTART_SPECIALS) so restart-service.sh and the
# service watchdog stay in lock-step with this boot script.
echo ""
echo "Starting special-case services…"
echo ""
for name in "${!RESTART_SPECIALS[@]}"; do
  IFS='|' read -r session dir cmd port <<< "${RESTART_SPECIALS[$name]}"
  clean_restart "$name" "$session" "$dir" "$cmd" "$port"
done

echo ""
echo "========================================"
echo "Auto-start script completed at $(date)"
echo "========================================"
echo ""
echo "Active tmux sessions:"
tmux list-sessions 2>&1 || echo "No active sessions"
