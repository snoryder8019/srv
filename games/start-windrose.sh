#!/bin/bash
# Windrose Dedicated Server Startup Script (Proton-GE)
# Runs inside tmux session "windrose" as gs-windrose user via Proton.
# Switched from vanilla Wine 9.0 to Proton-GE 10-34 to work around a gRPC
# Windows IOCP assertion (ASSERTION FAILED: result.bytes_transferred ==
# buffer_->Length() in windows_endpoint.cc) that crashed the server during
# the initial replication burst when a player connected.
# Wine fallback: see start-windrose.sh.wine-backup

WINDROSE_DIR="/srv/games/windrose"
SESSION="windrose"
GS_USER="gs-windrose"

LOG_FILE="$WINDROSE_DIR/logs/server.log"
PROTON_DIR="/srv/games/proton-ge"
COMPAT_DATA="$WINDROSE_DIR/.proton"

SERVER_EXE="$WINDROSE_DIR/R5/Binaries/Win64/WindroseServer-Win64-Shipping.exe"

# Kill existing session if running
sudo -u $GS_USER tmux kill-session -t $SESSION 2>/dev/null

sudo -u $GS_USER tmux new-session -d -s $SESSION -x 220 -y 50

# Proton requires STEAM_COMPAT_DATA_PATH (its prefix dir) and
# STEAM_COMPAT_CLIENT_INSTALL_PATH (a Steam-install-like path; we point at
# Proton itself since we're not running through Steam). Proton auto-inits
# the prefix on first run.
# -log tells UE5 to mirror output to stdout.
# WINEDLLOVERRIDES forces Proton's loader to prefer the UE4SS-shipped
# dwmapi.dll (proxy/loader sitting next to the EXE) over Wine's builtin.
# Without this, UE4SS never injects and UE4SS.log is never created.
sudo -u $GS_USER tmux send-keys -t $SESSION "cd $WINDROSE_DIR && \
  STEAM_COMPAT_DATA_PATH=$COMPAT_DATA \
  STEAM_COMPAT_CLIENT_INSTALL_PATH=$PROTON_DIR \
  WINEDLLOVERRIDES='dwmapi=n,b' \
  xvfb-run -a $PROTON_DIR/proton run $SERVER_EXE -log 2>&1 | tee -a $LOG_FILE" Enter

echo "Windrose server started in tmux session '$SESSION' (user: $GS_USER, runtime: Proton-GE)"
echo "Attach with: sudo -u $GS_USER tmux attach -t $SESSION"
echo ""
echo "Networking: Windrose uses NAT punch-through + invite codes."
echo "Invite code is in $WINDROSE_DIR/R5/Saved/Config/... or server console."
