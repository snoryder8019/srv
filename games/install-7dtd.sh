#!/bin/bash
# 7 Days to Die Dedicated Server Installer
# App ID: 294420 (anonymous login)

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
SDTD_DIR="/srv/games/7dtd"
SDTD_APP_ID="294420"

echo "=== Installing 7 Days to Die Dedicated Server ==="
$STEAMCMD +force_install_dir "$SDTD_DIR" +login anonymous +app_update $SDTD_APP_ID validate +quit

echo ""
echo "=== Creating directories ==="
mkdir -p "$SDTD_DIR/logs"
mkdir -p "$SDTD_DIR/Mods"
mkdir -p "$SDTD_DIR/Mods_disabled"
mkdir -p "$SDTD_DIR/UserDataFolder/Saves"

echo ""
echo "=== Done! Edit $SDTD_DIR/serverconfig.xml then run ./start-7dtd.sh ==="
