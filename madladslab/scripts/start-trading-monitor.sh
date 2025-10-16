#!/bin/bash

# Trading Bot Monitor Startup Script
# This script starts the automated trading bot monitor in the background

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
PID_FILE="$LOG_DIR/trading-monitor.pid"
LOG_FILE="$LOG_DIR/trading-monitor.log"

# Create logs directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Check if already running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null 2>&1; then
        echo "Trading monitor is already running (PID: $PID)"
        exit 1
    else
        echo "Removing stale PID file..."
        rm "$PID_FILE"
    fi
fi

echo "Starting Trading Bot Monitor..."
echo "Log file: $LOG_FILE"

# Start the monitor in the background
cd "$PROJECT_DIR"
nohup node scripts/trading-bot-monitor.js >> "$LOG_FILE" 2>&1 &

# Save the PID
PID=$!
echo $PID > "$PID_FILE"

echo "Trading Bot Monitor started (PID: $PID)"
echo "To stop: ./scripts/stop-trading-monitor.sh"
echo "To view logs: tail -f $LOG_FILE"
