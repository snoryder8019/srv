#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  MadLadsLab — Start All Services
#  Usage: bash /srv/start-all-services.sh [--restart-only]
#  --restart-only  kills & restarts only already-running sessions
# ═══════════════════════════════════════════════════════════

RESTART_ONLY=false
[[ "$1" == "--restart-only" ]] && RESTART_ONLY=true

# name : port : directory : start command
# Port env var is passed as PORT=<port> unless the service uses its own var
SERVICES=(
  "slab:3602:/srv/slab:node bin/www.js"
  "games:3500:/srv/games:node app.js"
  "graffiti-tv:3001:/srv/graffiti-tv:node ./bin/www"
  "greealitytv:3400:/srv/greealitytv:node app.js"
  "madladslab:3000:/srv/madladslab:node ./bin/www"
  "ps:3399:/srv/ps:node ./bin/www"
  "opsTrain:3603:/srv/opsTrain:node bin/www"
  "nocometalworkz:3002:/srv/nocometalworkz:node ./bin/www"
  "mcp-streamable:3650:/srv/mcp:node mcp-http.js"
  "mobile-meadows:3700:/srv/mobile-meadows:node app.js"
)

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║     MadLadsLab — Service Startup          ║"
echo "╚══════════════════════════════════════════╝"
echo ""

started=0
skipped=0
failed=0

for svc in "${SERVICES[@]}"; do
  IFS=':' read -r name port dir cmd <<< "$svc"

  # Skip if --restart-only and session doesn't exist
  if $RESTART_ONLY && ! tmux has-session -t "$name" 2>/dev/null; then
    echo "  ⏭  $name — skipped (not running)"
    ((skipped++))
    continue
  fi

  # Kill existing session
  tmux kill-session -t "$name" 2>/dev/null

  if [ ! -d "$dir" ]; then
    echo "  ❌  $name — directory not found: $dir"
    ((failed++))
    continue
  fi

  # Special port env vars
  if [[ "$name" == "games" ]]; then
    env_prefix="GAMES_PORT=$port"
  else
    env_prefix="PORT=$port"
  fi

  tmux new-session -d -s "$name" -c "$dir" "$env_prefix $cmd"
  sleep 1

  # Verify it came up
  pid=$(lsof -ti :$port 2>/dev/null | head -1)
  if [ -n "$pid" ]; then
    echo "  ✅  $name — port $port (pid $pid)"
    ((started++))
  else
    echo "  ⚠   $name — started but port $port not yet listening (may still be booting)"
    ((started++))
  fi
done

echo ""
echo "══════════════════════════════════════════"
echo "  Started: $started  |  Skipped: $skipped  |  Failed: $failed"
echo "══════════════════════════════════════════"
echo ""
echo "  View logs:   tmux attach -t <n>"
echo "  List all:    tmux ls"
echo ""
