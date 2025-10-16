#!/bin/bash

# Trading Bot Monitor Stop Script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
PID_FILE="$LOG_DIR/trading-monitor.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "Trading monitor is not running (no PID file found)"
    exit 1
fi

PID=$(cat "$PID_FILE")

if ! ps -p $PID > /dev/null 2>&1; then
    echo "Trading monitor is not running (stale PID file)"
    rm "$PID_FILE"
    exit 1
fi

echo "Stopping Trading Bot Monitor (PID: $PID)..."
kill -TERM $PID

# Wait for process to stop
for i in {1..10}; do
    if ! ps -p $PID > /dev/null 2>&1; then
        echo "Trading Bot Monitor stopped successfully"
        rm "$PID_FILE"
        exit 0
    fi
    sleep 1
done

# Force kill if still running
echo "Force stopping..."
kill -9 $PID
rm "$PID_FILE"
echo "Trading Bot Monitor stopped"
