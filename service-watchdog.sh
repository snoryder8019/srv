#!/bin/bash
# ─────────────────────────────────────────────────────────────────
# service-watchdog.sh — MadLabs service health monitor & auto-boot
# Runs via cron every 5 minutes. Checks HTTP port, restarts if down.
# ─────────────────────────────────────────────────────────────────

CONFIG="/srv/service-watchdog.json"
LOG="/srv/service-watchdog.log"
MAX_LOG_LINES=1000

# Trim log to last MAX_LOG_LINES lines
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt "$MAX_LOG_LINES" ]; then
    tail -n "$MAX_LOG_LINES" "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG"; }

port_alive() {
    local port="$1"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 "http://localhost:$port/" 2>/dev/null)
    [ "$code" != "000" ] && [ -n "$code" ]
}

session_alive() {
    tmux has-session -t "$1" 2>/dev/null
}

start_service() {
    local name="$1" dir="$2" session="$3" cmd="$4"

    # Kill stale session if it exists
    if session_alive "$session"; then
        log "  ↳ killing stale session: $session"
        tmux kill-session -t "$session" 2>/dev/null
        sleep 1
    fi

    # Also clean up any legacy _session variant
    if session_alive "${name}_session"; then
        tmux kill-session -t "${name}_session" 2>/dev/null
    fi

    if [ ! -d "$dir" ]; then
        log "  ↳ ERROR: directory not found: $dir"
        return 1
    fi

    tmux new-session -d -s "$session" -c "$dir" "$cmd" 2>/dev/null
    sleep 3

    if session_alive "$session"; then
        log "  ↳ ✅ started: $session"
        return 0
    else
        log "  ↳ ❌ failed to start: $session"
        return 1
    fi
}

if ! command -v jq &>/dev/null; then
    log "ERROR: jq not installed"
    exit 1
fi

log "── watchdog run ──────────────────────────────"

while IFS= read -r svc; do
    name=$(echo "$svc"    | jq -r '.name')
    dir=$(echo "$svc"     | jq -r '.dir')
    port=$(echo "$svc"    | jq -r '.port')
    session=$(echo "$svc" | jq -r '.session')
    cmd=$(echo "$svc"     | jq -r '.cmd')

    if port_alive "$port"; then
        log "  ✅ $name (port $port)"
    else
        log "  ⚠️  $name (port $port) — DOWN, restarting..."
        start_service "$name" "$dir" "$session" "$cmd"
    fi

done < <(jq -c '.[]' "$CONFIG")

log "── done ──────────────────────────────────────"
