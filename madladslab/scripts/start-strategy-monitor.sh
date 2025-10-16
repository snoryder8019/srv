#!/bin/bash

cd "$(dirname "$0")/.."

echo "🚀 Starting Strategy Monitor..."

# Check if already running
if tmux has-session -t strategy-monitor 2>/dev/null; then
    echo "⚠️  Strategy monitor is already running in tmux session 'strategy-monitor'"
    echo "   Use './scripts/status-strategy-monitor.sh' to check status"
    echo "   Use './scripts/stop-strategy-monitor.sh' to stop it"
    exit 1
fi

# Start in new tmux session
tmux new-session -d -s strategy-monitor "cd /srv/madladslab && node scripts/strategy-monitor.js"

echo "✅ Strategy monitor started in tmux session 'strategy-monitor'"
echo ""
echo "Commands:"
echo "  - View logs:   tmux attach -t strategy-monitor"
echo "  - Check status: ./scripts/status-strategy-monitor.sh"
echo "  - Stop monitor: ./scripts/stop-strategy-monitor.sh"
