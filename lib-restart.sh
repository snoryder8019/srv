# shellcheck shell=bash
# ─────────────────────────────────────────────────────────────────────────────
# lib-restart.sh — shared clean-restart helpers for the srv tmux services.
# SOURCE this file ("source /srv/lib-restart.sh"); do not execute it.
#
# A "clean restart" means: kill every tmux session that could be running the
# service (the canonical BARE "<name>" and any legacy "<name>_session"), free its
# TCP port if one is known (catches a process that outlived its session), then
# start one fresh session under the bare name. It never uses killall/pkill — port
# teardown is targeted via `fuser -k`, per the lab's ops rules.
#
# Session names are BARE ("slab", "reels", "cards") to match the authoritative
# registry in /srv/service-watchdog.json — the cron watchdog respawns services
# under bare names and actively kills "_session" variants, so anything we start
# as "<name>_session" would just get torn down and duplicated. Keep them bare.
#
# Requires: tmux, jq, fuser (psmisc).
# ─────────────────────────────────────────────────────────────────────────────

CONFIG_FILE="${CONFIG_FILE:-/srv/auto-start-npm.json}"

# Services that the JSON-key loop can't express because they live outside
# /srv/<name> or need a non-standard session name. Keyed by service name:
#   name -> "session|dir|cmd|port"   (port may be empty)
# Keep these in sync with anything that also reads them (e.g. service-watchdog).
declare -A RESTART_SPECIALS=(
  [mcp-streamable]="mcp-streamable|/srv/mcp|node mcp-http.js|3650"
  [mllOauth]="mllOauth|/srv/mllOauth|node server.js|3651"
  [cards]="cards|/srv/games/arcade/cards|npm start|3600"
  [matchmaking]="matchmaking|/srv/games/matchmaking|npm start|3610"
  [reels]="reels|/srv/games/arcade/reels|npm start|3740"
)

# free_port <port> — kill whatever holds this TCP port. No-op when port is blank.
free_port() {
  local port="$1"
  [ -z "$port" ] && return 0
  fuser -k -n tcp "$port" >/dev/null 2>&1 || true
}

# clean_restart <name> <session> <dir> <cmd> <port>
# Tears down every plausible session for <name> + the port, then starts <session>.
# Emits a single ✓/✗ status line. Returns non-zero on failure to start.
clean_restart() {
  local name="$1" session="$2" dir="$3" cmd="$4" port="$5"

  local s
  for s in "$session" "$name" "${name}_session"; do
    if tmux has-session -t "=$s" 2>/dev/null; then
      tmux kill-session -t "=$s" >/dev/null 2>&1
    fi
  done
  free_port "$port"
  sleep 1

  if [ ! -d "$dir" ];               then echo "✗ $name: directory $dir missing"; return 1; fi
  if [ ! -f "$dir/package.json" ];  then echo "✗ $name: no package.json in $dir"; return 1; fi

  tmux new-session -d -s "$session" -c "$dir" "$cmd"
  if tmux has-session -t "=$session" 2>/dev/null; then
    echo "✓ $name: started '$session' ($cmd in $dir${port:+, port $port})"
    return 0
  fi
  echo "✗ $name: FAILED to start '$session'"
  return 1
}

# restart_service <name> — resolve <name> (special first, then JSON) and restart.
# JSON-managed services run "<cmd>" in /srv/<name> as "<name>_session".
restart_service() {
  local name="$1"
  if [ -z "$name" ]; then echo "restart_service: no name given"; return 2; fi

  if [ -n "${RESTART_SPECIALS[$name]:-}" ]; then
    local IFS='|'; read -r session dir cmd port <<< "${RESTART_SPECIALS[$name]}"
    clean_restart "$name" "$session" "$dir" "$cmd" "$port"
    return $?
  fi

  if [ ! -f "$CONFIG_FILE" ]; then echo "✗ $name: config $CONFIG_FILE not found"; return 2; fi
  local row
  row=$(jq -r --arg k "$name" '.[$k] // empty | "\(.cmd)\t\(.port // "")"' "$CONFIG_FILE")
  if [ -z "$row" ]; then echo "✗ unknown service '$name' (not in $CONFIG_FILE or specials)"; return 2; fi

  local cmd port
  IFS=$'\t' read -r cmd port <<< "$row"
  clean_restart "$name" "$name" "/srv/$name" "$cmd" "$port"
}

# restart_all_names — every restartable service name (JSON keys + specials).
restart_all_names() {
  { jq -r 'keys[]' "$CONFIG_FILE" 2>/dev/null; printf '%s\n' "${!RESTART_SPECIALS[@]}"; } | sort -u
}
