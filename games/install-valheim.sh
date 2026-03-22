#!/bin/bash
# Valheim Dedicated Server Installer
# Installs Valheim server into /srv/games/valheim/

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
VALHEIM_DIR="/srv/games/valheim"
VALHEIM_APP_ID="896660"

echo "=== Installing Valheim Dedicated Server ==="
$STEAMCMD +force_install_dir "$VALHEIM_DIR" +login anonymous +app_update $VALHEIM_APP_ID validate +quit

echo ""
echo "=== Creating directories ==="
mkdir -p "$VALHEIM_DIR/logs"
mkdir -p "$VALHEIM_DIR/worlds"
mkdir -p "$VALHEIM_DIR/BepInEx/plugins"
mkdir -p "$VALHEIM_DIR/BepInEx/plugins/disabled"

echo ""
echo "=== Done! Run ./start-valheim.sh to launch the server ==="
