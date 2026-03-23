#!/bin/bash
# Left 4 Dead 2 Dedicated Server Startup Script
# Runs inside tmux session "l4d2"

L4D2_DIR="/srv/games/l4d2"
SESSION="l4d2"

# Server config — edit these
SERVER_NAME="MadLadsLab L4D2"
SERVER_PASSWORD=""
MAX_PLAYERS=8
SERVER_PORT=27015
STARTING_MAP="c1m1_hotel"

# Kill existing session if running
tmux kill-session -t $SESSION 2>/dev/null

mkdir -p "$L4D2_DIR/logs"
tmux new-session -d -s $SESSION -x 220 -y 50

tmux send-keys -t $SESSION "cd $L4D2_DIR && ./srcds_run \
  -game left4dead2 \
  -console \
  -usercon \
  -port $SERVER_PORT \
  -maxplayers $MAX_PLAYERS \
  +hostname \"$SERVER_NAME\" \
  +sv_lan 0 \
  +map $STARTING_MAP \
  2>&1 | tee -a $L4D2_DIR/logs/console.log" Enter

echo "L4D2 server started in tmux session '$SESSION'"
echo "Attach with: tmux attach -t $SESSION"
echo ""
echo "Ports:"
echo "  Game: $SERVER_PORT (UDP/TCP)"
