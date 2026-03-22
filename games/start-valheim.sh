#!/bin/bash
# Valheim Dedicated Server Startup Script
# Runs inside tmux session "valheim"

VALHEIM_DIR="/srv/games/valheim"
SESSION="valheim"

# Server config — edit these
SERVER_NAME="MadLadsLab Valheim"
SERVER_PASSWORD="changeme_valheim_pass"
WORLD_NAME="MadLads"
GAME_PORT=2456
SAVE_DIR="$VALHEIM_DIR/worlds"

# Kill existing session if running
tmux kill-session -t $SESSION 2>/dev/null

tmux new-session -d -s $SESSION -x 220 -y 50

tmux send-keys -t $SESSION "cd $VALHEIM_DIR && ./valheim_server.x86_64 \
  -name \"$SERVER_NAME\" \
  -port $GAME_PORT \
  -world \"$WORLD_NAME\" \
  -password \"$SERVER_PASSWORD\" \
  -savedir \"$SAVE_DIR\" \
  -public 1 \
  2>&1 | tee -a $VALHEIM_DIR/logs/server.log" Enter

echo "Valheim server started in tmux session '$SESSION'"
echo "Attach with: tmux attach -t $SESSION"
echo ""
echo "Ports:"
echo "  Game:  $GAME_PORT (UDP)"
echo "  Query: $((GAME_PORT + 1)) (UDP)"
