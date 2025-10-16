#!/bin/bash

echo "🛑 Stopping Strategy Monitor..."

# Check if running
if ! tmux has-session -t strategy-monitor 2>/dev/null; then
    echo "⚠️  Strategy monitor is not running"
    exit 1
fi

# Kill the tmux session
tmux kill-session -t strategy-monitor

echo "✅ Strategy monitor stopped"
