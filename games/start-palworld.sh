#!/bin/bash
# Palworld Dedicated Server Startup Script
# Runs inside tmux session "palworld" as gs-palworld user

PALWORLD_DIR="/srv/games/palworld"
SESSION="palworld"
GS_USER="gs-palworld"

GAME_PORT=8211
LOG_FILE="$PALWORLD_DIR/logs/server.log"

# Kill existing session if running
sudo -u $GS_USER tmux kill-session -t $SESSION 2>/dev/null

sudo -u $GS_USER tmux new-session -d -s $SESSION -x 220 -y 50

# Palworld DS — native Linux binary
sudo -u $GS_USER tmux send-keys -t $SESSION "cd $PALWORLD_DIR && ./PalServer.sh -port=$GAME_PORT -useperfthreads -NoAsyncLoadingThread -UseMultithreadForDS 2>&1 | tee -a $LOG_FILE" Enter

echo "Palworld server started in tmux session '$SESSION' (user: $GS_USER)"
echo "Attach with: sudo -u $GS_USER tmux attach -t $SESSION"
echo ""
echo "Ports:"
echo "  Game: $GAME_PORT (UDP)"
