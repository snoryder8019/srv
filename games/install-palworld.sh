#!/bin/bash
# Palworld Dedicated Server Installer
# Installs Palworld DS into /srv/games/dedicatedServers/palworld/

STEAMCMD="/srv/games/steamcmd/steamcmd.sh"
PALWORLD_DIR="/srv/games/dedicatedServers/palworld"
PALWORLD_APP_ID="2394010"

echo "=== Installing Palworld Dedicated Server ==="
$STEAMCMD +force_install_dir "$PALWORLD_DIR" +login anonymous +app_update $PALWORLD_APP_ID validate +quit

echo ""
echo "=== Creating directories ==="
mkdir -p "$PALWORLD_DIR/logs"

echo ""
echo "=== Done! Run ./start-palworld.sh to launch the server ==="
