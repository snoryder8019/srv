#!/bin/bash

echo "📊 Strategy Monitor Status"
echo "=========================="

# Check if running
if tmux has-session -t strategy-monitor 2>/dev/null; then
    echo "Status: ✅ RUNNING"
    echo ""
    echo "Recent logs:"
    echo "----------"
    tmux capture-pane -t strategy-monitor -p | tail -20
    echo ""
    echo "To view live logs: tmux attach -t strategy-monitor"
else
    echo "Status: ⏹️  STOPPED"
    echo ""
    echo "To start: ./scripts/start-strategy-monitor.sh"
fi
