#!/bin/bash

# Start All MadLads Lab Services in Tmux
# This script creates a tmux session for each service

echo "Starting all services in tmux sessions..."

# Service configurations: name:port:directory:command
SERVICES=(
  "madladslab:3000:/srv/madladslab:npm start"
  "ps:3399:/srv/ps:npm start"
  "game-state:3500:/srv/game-state-service:node index.js"
  "acm:3001:/srv/acm:npm start"
  "nocometalworkz:3002:/srv/nocometalworkz:npm start"
  "sfg:3003:/srv/sfg:npm start"
  "sna:3004:/srv/sna:npm start"
  "twww:3005:/srv/twww:npm start"
  "w2portal:3006:/srv/w2MongoClient:npm start"
  "madThree:3007:/srv/madThree:npm start"
)

# Kill existing sessions
for service_config in "${SERVICES[@]}"; do
  IFS=':' read -r name port dir cmd <<< "$service_config"
  tmux kill-session -t "$name" 2>/dev/null
done

# Start each service in its own tmux session
for service_config in "${SERVICES[@]}"; do
  IFS=':' read -r name port dir cmd <<< "$service_config"

  if [ -d "$dir" ]; then
    echo "Starting $name on port $port..."
    tmux new-session -d -s "$name" -c "$dir" "PORT=$port $cmd"
    sleep 1
  else
    echo "Warning: Directory $dir not found for $name"
  fi
done

echo ""
echo "All services started! Use these commands to view logs:"
echo "  tmux attach -t <service-name>"
echo ""
echo "Available services:"
for service_config in "${SERVICES[@]}"; do
  IFS=':' read -r name port dir cmd <<< "$service_config"
  echo "  - $name (port $port): tmux attach -t $name"
done

echo ""
echo "To see all running sessions: tmux ls"
