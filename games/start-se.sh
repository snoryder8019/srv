#!/bin/bash
# Space Engineers 1 Dedicated Server Startup Script
# Runs inside tmux session "se" as gs-se user via Wine

SE_DIR="/srv/games/se"
SESSION="se"
GS_USER="gs-se"

GAME_PORT=27016
LOG_FILE="$SE_DIR/logs/server.log"
WINEPREFIX="$SE_DIR/.wine"

# Ensure Wine prefix exists for gs-se
if [ ! -d "$WINEPREFIX" ]; then
  echo "Initializing Wine prefix for $GS_USER..."
  sudo -u $GS_USER WINEPREFIX="$WINEPREFIX" WINEDLLOVERRIDES="mscoree,mshtml=" wineboot --init 2>/dev/null
  echo "Wine prefix initialized."
fi

# Kill existing session if running
sudo -u $GS_USER tmux kill-session -t $SESSION 2>/dev/null

sudo -u $GS_USER tmux new-session -d -s $SESSION -x 220 -y 50

# Launch via Xvfb (virtual display) + Wine
# SE DS needs a display even in headless mode
sudo -u $GS_USER tmux send-keys -t $SESSION "cd $SE_DIR/DedicatedServer64 && WINEPREFIX=$WINEPREFIX DISPLAY=:99 xvfb-run -a -n 99 wine SpaceEngineersDedicated.exe -noconsole -path $SE_DIR/Instance 2>&1 | tee -a $LOG_FILE" Enter

echo "Space Engineers server started in tmux session '$SESSION' (user: $GS_USER)"
echo "Attach with: sudo -u $GS_USER tmux attach -t $SESSION"
echo ""
echo "Ports:"
echo "  Game: $GAME_PORT (UDP)"
