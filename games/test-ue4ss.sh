#!/bin/bash
# UE4SS smoke test for the Proton-GE Windrose server.
# Validates that the UE4SS DLL proxy loads inside Proton's prefix and
# that the server stays alive long enough to host Lua mods (WindrosePlus,
# Server RESTAPI, etc). Run before any modbuilder work.

set -u

WINDROSE_DIR="/srv/games/windrose"
GS_USER="gs-windrose"
SESSION="windrose"
WIN64_DIR="$WINDROSE_DIR/R5/Binaries/Win64"
UE4SS_DIR="$WIN64_DIR/ue4ss"
UE4SS_LOG="$UE4SS_DIR/UE4SS.log"
UE4SS_DLL="$UE4SS_DIR/UE4SS.dll"
UE4SS_INI="$UE4SS_DIR/UE4SS-settings.ini"
PROXY_DLL="$WIN64_DIR/dwmapi.dll"
SERVER_LOG="$WINDROSE_DIR/logs/server.log"
START_SCRIPT="$(cd "$(dirname "$0")" && pwd)/start-windrose.sh"

red()    { printf '\033[31m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }
step()   { printf '\n=== %s ===\n' "$*"; }

step "Step 1 — preflight"
fail=0
[[ -d "$WIN64_DIR" ]] || { red "  FAIL: $WIN64_DIR missing — windrose not installed"; exit 1; }

if [[ ! -f "$PROXY_DLL" ]]; then
  red "  FAIL: $PROXY_DLL not present"
  echo "  Extract UE4SS experimental into $WIN64_DIR/ before re-running:"
  echo "    - $WIN64_DIR/dwmapi.dll          (proxy/loader)"
  echo "    - $UE4SS_DIR/UE4SS.dll"
  echo "    - $UE4SS_DIR/UE4SS-settings.ini  (set MajorVersion=5, MinorVersion=6)"
  echo "  Source: https://github.com/UE4SS-RE/RE-UE4SS/releases/tag/experimental-latest"
  fail=1
fi
[[ -f "$UE4SS_DLL" ]] || { red "  FAIL: $UE4SS_DLL missing"; fail=1; }
[[ -f "$UE4SS_INI" ]] || yellow "  WARN: UE4SS-settings.ini missing — defaults will apply"
[[ $fail -eq 1 ]] && exit 1
green "  preflight ok"

step "Step 2 — restart windrose"
echo "This kills tmux session '$SESSION' and re-runs start-windrose.sh."
read -r -p "Continue? [y/N] " ans
[[ "${ans,,}" =~ ^y(es)?$ ]] || { yellow "  aborted"; exit 2; }

sudo -u "$GS_USER" rm -f "$UE4SS_LOG" 2>/dev/null || true
sudo -u "$GS_USER" tmux kill-session -t "$SESSION" 2>/dev/null || true
sleep 2
bash "$START_SCRIPT"
green "  windrose restart issued"

step "Step 3 — wait for UE4SS.log (90s)"
deadline=$(( $(date +%s) + 90 ))
while [[ $(date +%s) -lt $deadline ]]; do
  [[ -f "$UE4SS_LOG" ]] && { green "  UE4SS.log created"; break; }
  sleep 2
done
if [[ ! -f "$UE4SS_LOG" ]]; then
  red "  FAIL: UE4SS.log not produced — DLL proxy did not load under Proton"
  echo "  Try adding 'WINEDLLOVERRIDES=dwmapi=n,b' to start-windrose.sh and rerun."
  echo
  echo "Last 30 lines of $SERVER_LOG:"
  tail -n 30 "$SERVER_LOG" 2>/dev/null || echo "(no server log yet)"
  exit 3
fi

step "Step 4 — wait for UE4SS to attach to game (60s)"
deadline=$(( $(date +%s) + 60 ))
ready=0
while [[ $(date +%s) -lt $deadline ]]; do
  if grep -qE "(PS scan successful|Using engine version|Locating KismetSystemLibrary)" "$UE4SS_LOG"; then
    ready=1; break
  fi
  sleep 2
done
if [[ $ready -eq 0 ]]; then
  red "  FAIL: UE4SS loaded but never attached to the game"
  echo
  echo "UE4SS.log:"
  cat "$UE4SS_LOG"
  exit 4
fi
green "  UE4SS attached"

step "Step 5 — 30s soak"
sleep 30
if ! sudo -u "$GS_USER" tmux has-session -t "$SESSION" 2>/dev/null; then
  red "  FAIL: tmux session died after UE4SS attach"
  exit 5
fi
if ! pgrep -u "$GS_USER" -f WindroseServer >/dev/null; then
  red "  FAIL: WindroseServer process exited after UE4SS attach"
  exit 5
fi
green "  server stable for 30s with UE4SS attached"

step "PASS"
echo "  UE4SS is loading and attaching cleanly under Proton-GE."
echo "  Next: install WindrosePlus into $UE4SS_DIR/Mods/ and rerun this script."
echo "  UE4SS.log: $(wc -l < "$UE4SS_LOG") lines"
echo "  server log: $(wc -l < "$SERVER_LOG") lines"
