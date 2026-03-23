#!/bin/bash
# Left 4 Dead 2 Dedicated Server Installer
# App ID: 222860 (anonymous login)

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
L4D2_DIR="/srv/games/l4d2"
L4D2_APP_ID="222860"

echo "=== Installing Left 4 Dead 2 Dedicated Server ==="
$STEAMCMD +force_install_dir "$L4D2_DIR" +login anonymous +app_update $L4D2_APP_ID validate +quit

echo ""
echo "=== Creating directories ==="
mkdir -p "$L4D2_DIR/logs"
mkdir -p "$L4D2_DIR/addons/sourcemod/plugins/disabled"
mkdir -p "$L4D2_DIR/left4dead2/cfg"

echo ""
echo "=== Done! Run ./start-l4d2.sh to launch the server ==="
