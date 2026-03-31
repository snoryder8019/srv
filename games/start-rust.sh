#!/bin/bash
# Rust Dedicated Server Startup Script
# Runs inside tmux session "rust"

RUST_DIR="/srv/games/rust"
SESSION="rust"

# Server config — edit these
SERVER_IDENTITY="madlads"
SERVER_NAME="MadLadsLab Rust"
SERVER_DESC="MadLadsLab Official Rust Server"
SERVER_URL="https://games.madladslab.com"
SERVER_IMG=""
MAX_PLAYERS=100
WORLD_SIZE=2500
WORLD_SEED=12345
SERVER_PORT=28015
RCON_PORT=28016
RCON_PASS="changeme_rcon_pass"
QUERY_PORT=28017

# Kill existing session if running
tmux kill-session -t $SESSION 2>/dev/null

tmux new-session -d -s $SESSION -x 220 -y 50

tmux send-keys -t $SESSION "export HOME=/root && export TERM=xterm && export DOORSTOP_ENABLED=1 && export DOORSTOP_TARGET_ASSEMBLY=$RUST_DIR/carbon/managed/Carbon.Preloader.dll && export LD_PRELOAD=$RUST_DIR/libdoorstop.so && export LD_LIBRARY_PATH=$RUST_DIR:$RUST_DIR/RustDedicated_Data/Plugins/x86_64:\$LD_LIBRARY_PATH && cd $RUST_DIR && ./RustDedicated \
  -batchmode \
  -nographics \
  +server.identity \"$SERVER_IDENTITY\" \
  +server.hostname \"$SERVER_NAME\" \
  +server.description \"$SERVER_DESC\" \
  +server.url \"$SERVER_URL\" \
  +server.maxplayers $MAX_PLAYERS \
  +server.worldsize $WORLD_SIZE \
  +server.seed $WORLD_SEED \
  +server.port $SERVER_PORT \
  +rcon.port $RCON_PORT \
  +rcon.password \"$RCON_PASS\" \
  +rcon.web 1 \
  +query_port $QUERY_PORT \
  +app.port 28082 \
  2>&1 | tee -a /srv/games/rust/logs/server.log" Enter

echo "Rust server started in tmux session '$SESSION'"
echo "Attach with: tmux attach -t $SESSION"
echo ""
echo "Ports:"
echo "  Game:  $SERVER_PORT (UDP)"
echo "  RCON:  $RCON_PORT (TCP) — web RCON enabled"
echo "  Query: $QUERY_PORT (UDP)"
echo "  App:   28082 (Rust+ companion app)"
