#!/bin/bash

# Start MCP Server Script
# Creates a tmux session for the MCP server

SESSION_NAME="mcp-server"
MCP_DIR="/srv/mcp"

echo "Starting MCP Server in tmux session: $SESSION_NAME"

# Check if session already exists
if tmux has-session -t $SESSION_NAME 2>/dev/null; then
    echo "Session $SESSION_NAME already exists. Killing old session..."
    tmux kill-session -t $SESSION_NAME
fi

# Create new tmux session
echo "Creating new tmux session: $SESSION_NAME"
tmux new-session -d -s $SESSION_NAME -c $MCP_DIR "npm start"

# Verify session started
sleep 2
if tmux has-session -t $SESSION_NAME 2>/dev/null; then
    echo "✅ MCP Server started successfully in tmux session: $SESSION_NAME"
    echo ""
    echo "To view logs:"
    echo "  tmux attach -t $SESSION_NAME"
    echo ""
    echo "To detach from session:"
    echo "  Press Ctrl+B, then D"
    echo ""
    echo "To stop MCP server:"
    echo "  tmux kill-session -t $SESSION_NAME"
else
    echo "❌ Failed to start MCP server"
    exit 1
fi
