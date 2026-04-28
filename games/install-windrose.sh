#!/bin/bash
# Windrose Dedicated Server Installer
# Installs Windrose DS into /srv/games/windrose/
# NOTE: Windrose is a Windows-only binary. We force SteamCMD to fetch
# the Windows build and run it under Wine (same pattern as Space Engineers).
# App ID 4129620 supports anonymous login — no game purchase required.

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
WINDROSE_DIR="/srv/games/windrose"
WINDROSE_APP_ID="4129620"

echo "=== Installing Windrose Dedicated Server (Windows build via SteamCMD) ==="
sudo -u gs-windrose $STEAMCMD \
  +@sSteamCmdForcePlatformType windows \
  +force_install_dir "$WINDROSE_DIR" \
  +login anonymous \
  +app_update $WINDROSE_APP_ID validate \
  +quit

echo ""
echo "=== Creating directories ==="
sudo -u gs-windrose mkdir -p "$WINDROSE_DIR/logs"

echo ""
echo "=== Done! Edit ServerDescription.json (after first launch), then run ./start-windrose.sh ==="
