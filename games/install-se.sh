#!/bin/bash
# Space Engineers 1 Dedicated Server Installer
# Installs SE DS into /srv/games/se/

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
SE_DIR="/srv/games/se"
SE_APP_ID="298740"

echo "=== Installing Space Engineers Dedicated Server ==="
$STEAMCMD +force_install_dir "$SE_DIR" +login anonymous +app_update $SE_APP_ID validate +quit

echo ""
echo "=== Creating directories ==="
mkdir -p "$SE_DIR/logs"
mkdir -p "$SE_DIR/mods"
mkdir -p "$SE_DIR/mods_disabled"
mkdir -p "$SE_DIR/Instance/Saves"

echo ""
echo "=== Done! Edit start-se.sh config, then run ./start-se.sh to launch ==="
