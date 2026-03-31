#!/bin/bash
# Left 4 Dead 2 Dedicated Server Startup Script
# Runs inside tmux session "l4d2" as gs-l4d2 user

L4D2_DIR="/srv/games/l4d2"
SESSION="l4d2"
GS_USER="gs-l4d2"

# Server config — edit these
SERVER_NAME="MadLadsLab L4D2"
SERVER_PASSWORD=""
MAX_PLAYERS=8
SERVER_PORT=27015
STARTING_MAP="c1m1_hotel"

# SourceTV config — spectator broadcast system
TV_PORT=27020
TV_NAME="MadLadsLab TV"
TV_DELAY=15
TV_MAXCLIENTS=32

# Kill existing session if running
sudo -u $GS_USER tmux kill-session -t $SESSION 2>/dev/null

mkdir -p "$L4D2_DIR/logs"
chown $GS_USER:$GS_USER "$L4D2_DIR/logs"
sudo -u $GS_USER tmux new-session -d -s $SESSION -x 220 -y 50

sudo -u $GS_USER tmux send-keys -t $SESSION "cd $L4D2_DIR && ./srcds_run \
  -game left4dead2 \
  -console \
  -usercon \
  -port $SERVER_PORT \
  -maxplayers $MAX_PLAYERS \
  +hostname \"$SERVER_NAME\" \
  +sv_lan 0 \
  +map $STARTING_MAP \
  +tv_enable 1 \
  +tv_port $TV_PORT \
  +tv_name \"$TV_NAME\" \
  +tv_delay $TV_DELAY \
  +tv_maxclients $TV_MAXCLIENTS \
  +tv_autodirector 1 \
  +tv_autorecord 1 \
  2>&1 | tee -a $L4D2_DIR/logs/console.log" Enter

echo "L4D2 server started in tmux session '$SESSION' (user: $GS_USER)"
echo "Attach with: sudo -u $GS_USER tmux attach -t $SESSION"
echo ""
echo "Ports:"
echo "  Game:     $SERVER_PORT (UDP/TCP)"
echo "  SourceTV: $TV_PORT (UDP) — spectator broadcast, auto-director ON"
