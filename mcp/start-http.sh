#!/bin/bash

# Start MCP HTTP API Server
# Allows Claude browser to connect via Custom Connectors

SESSION_NAME="mcp-http"
PORT=3600

echo "Starting MCP HTTP API server..."

# Check if session exists
if tmux has-session -t $SESSION_NAME 2>/dev/null; then
  echo "Session '$SESSION_NAME' already exists. Killing it..."
  tmux kill-session -t $SESSION_NAME
  sleep 1
fi

# Kill any process on the port
PID=$(lsof -ti:$PORT 2>/dev/null)
if [ ! -z "$PID" ]; then
  echo "Killing process on port $PORT (PID: $PID)"
  kill -9 $PID
  sleep 1
fi

# Start new session
tmux new-session -d -s $SESSION_NAME -c /srv/mcp "HTTP_PORT=$PORT node http-server.js"

sleep 2

# Verify it started
if tmux has-session -t $SESSION_NAME 2>/dev/null; then
  echo "✅ MCP HTTP API started successfully!"
  echo "   Session: $SESSION_NAME"
  echo "   Port: $PORT"
  echo ""
  echo "📡 External URL: http://YOUR_VM_IP:$PORT"
  echo "🔍 Health check: http://YOUR_VM_IP:$PORT/health"
  echo ""
  echo "Commands:"
  echo "  View logs:   tmux attach -t $SESSION_NAME"
  echo "  Detach:      Ctrl+B, then D"
  echo "  Stop:        tmux kill-session -t $SESSION_NAME"
else
  echo "❌ Failed to start MCP HTTP API"
  exit 1
fi
