#!/bin/bash
# 7 Days to Die Dedicated Server Startup Script
# Runs inside tmux session "7dtd"

SDTD_DIR="/srv/games/7dtd"
SESSION="7dtd"

# Kill existing session if running
tmux kill-session -t $SESSION 2>/dev/null

mkdir -p "$SDTD_DIR/logs"
tmux new-session -d -s $SESSION -x 220 -y 50

tmux send-keys -t $SESSION "cd $SDTD_DIR && ./7DaysToDieServer.x86_64 \
  -quit \
  -batchmode \
  -nographics \
  -configfile=serverconfig.xml \
  -dedicated \
  2>&1 | tee -a $SDTD_DIR/logs/output_log.txt" Enter

echo "7DTD server started in tmux session '$SESSION'"
echo "Attach with: tmux attach -t $SESSION"
echo ""
echo "Ports:"
echo "  Game:    26900 (UDP)"
echo "  Web UI:  8080 (TCP) — if enabled in serverconfig.xml"
echo "  Telnet:  8081 (TCP) — if enabled in serverconfig.xml"
