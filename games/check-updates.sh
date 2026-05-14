#!/bin/bash
# Game Server Update Checker + Auto-Updater
# Checks all 7 game servers for Steam updates.
# If a server is OFFLINE: updates immediately.
# If a server is ONLINE:  logs a notice only (no forced restart).
#
# Logs to /srv/games/logs/updates.log
# Usage: bash check-updates.sh [--force-update]

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
LOG_DIR="/srv/games/logs"
LOG_FILE="$LOG_DIR/updates.log"
FORCE_UPDATE="${1:-}"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# Returns installed buildid from appmanifest, or "0" if not installed
get_installed_buildid() {
  local acf="$1"
  if [ ! -f "$acf" ]; then echo "0"; return; fi
  grep '"buildid"' "$acf" | head -1 | awk '{print $2}' | tr -d '"'
}

# Returns latest buildid from Steam (via steamcmd app_info_print)
# Optional platform arg ("windows"|"linux") sets +@sSteamCmdForcePlatformType
# — required for Windows-only titles like Windrose since their public-branch
# buildid differs from any (nonexistent) Linux build.
get_latest_buildid() {
  local app_id="$1"
  local platform="${2:-}"
  local platform_flag=""
  [ -n "$platform" ] && platform_flag="+@sSteamCmdForcePlatformType $platform"
  "$STEAMCMD" $platform_flag \
    +login anonymous \
    +app_info_update 1 \
    +app_info_print "$app_id" \
    +quit 2>/dev/null \
    | grep -A 200 '"branches"' \
    | grep -A 5 '"public"' \
    | grep '"buildid"' \
    | head -1 \
    | awk '{print $2}' \
    | tr -d '"'
}

# Check + optionally update one game.
# Optional run_as: user to sudo to for tmux + steamcmd ops (e.g. gs-windrose).
# Optional platform: forces SteamCmdForcePlatformType (e.g. "windows").
check_game() {
  local name="$1"
  local app_id="$2"
  local install_dir="$3"
  local session="$4"
  local start_script="$5"
  local run_as="${6:-}"
  local platform="${7:-}"
  local acf="$install_dir/steamapps/appmanifest_${app_id}.acf"

  local sudo_prefix=""
  [ -n "$run_as" ] && sudo_prefix="sudo -u $run_as"

  if [ ! -d "$install_dir" ]; then
    log "[$name] Not installed — skipping"
    return
  fi

  local installed
  installed=$(get_installed_buildid "$acf")

  local latest
  latest=$(get_latest_buildid "$app_id" "$platform")

  if [ -z "$latest" ] || [ "$latest" = "0" ]; then
    log "[$name] Could not fetch latest buildid from Steam — skipping"
    return
  fi

  if [ "$installed" = "$latest" ]; then
    log "[$name] Up to date (build $installed)"
    return
  fi

  log "[$name] UPDATE AVAILABLE — installed: $installed  latest: $latest"

  # Check if server is running (run as the session owner so we see its tmux server)
  local running=0
  $sudo_prefix tmux has-session -t "$session" 2>/dev/null && running=1

  if [ "$running" = "1" ] && [ "$FORCE_UPDATE" != "--force-update" ]; then
    log "[$name] Server is ONLINE — skipping auto-update (run with --force-update to override)"
    return
  fi

  if [ "$running" = "1" ]; then
    log "[$name] Stopping server for update..."
    $sudo_prefix tmux kill-session -t "$session" 2>/dev/null
    sleep 3
  fi

  log "[$name] Running update..."
  local platform_flag=""
  [ -n "$platform" ] && platform_flag="+@sSteamCmdForcePlatformType $platform"
  $sudo_prefix "$STEAMCMD" $platform_flag \
    +force_install_dir "$install_dir" +login anonymous \
    +app_update "$app_id" validate +quit >> "$LOG_FILE" 2>&1

  local new_build
  new_build=$(get_installed_buildid "$acf")
  log "[$name] Update complete — now at build $new_build"

  if [ "$running" = "1" ] && [ -f "$start_script" ]; then
    log "[$name] Restarting server..."
    bash "$start_script"
    log "[$name] Server restarted"
  fi
}

log "=== Game server update check starting ==="

check_game "Rust"     "258550"  "/srv/games/rust"     "rust"     "/srv/games/start-rust.sh"
check_game "Valheim"  "896660"  "/srv/games/valheim"  "valheim"  "/srv/games/start-valheim.sh"
check_game "L4D2"     "222860"  "/srv/games/l4d2"     "l4d2"     "/srv/games/start-l4d2.sh"
check_game "7DTD"     "294420"  "/srv/games/7dtd"     "7dtd"     "/srv/games/start-7dtd.sh"
check_game "SE"       "298740"  "/srv/games/se"       "se"       "/srv/games/start-se.sh"
check_game "Palworld" "2394010" "/srv/games/palworld" "palworld" "/srv/games/start-palworld.sh"
check_game "Windrose" "4129620" "/srv/games/windrose" "windrose" "/srv/games/start-windrose.sh" "gs-windrose" "windows"

log "=== Update check complete ==="
