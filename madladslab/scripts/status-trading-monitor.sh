#!/bin/bash

# Trading Bot Monitor Status Script

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
PID_FILE="$LOG_DIR/trading-monitor.pid"
LOG_FILE="$LOG_DIR/trading-monitor.log"

echo "=========================================="
echo "Trading Bot Monitor Status"
echo "=========================================="

if [ ! -f "$PID_FILE" ]; then
    echo "Status: NOT RUNNING"
    exit 0
fi

PID=$(cat "$PID_FILE")

if ps -p $PID > /dev/null 2>&1; then
    echo "Status: RUNNING"
    echo "PID: $PID"
    echo "Uptime: $(ps -p $PID -o etime= | tr -d ' ')"
    echo "Memory: $(ps -p $PID -o rss= | awk '{printf "%.2f MB\n", $1/1024}')"
    echo "CPU: $(ps -p $PID -o %cpu= | tr -d ' ')%"
    echo ""
    echo "Recent log entries:"
    echo "------------------"
    tail -n 10 "$LOG_FILE" 2>/dev/null || echo "No log file found"
else
    echo "Status: NOT RUNNING (stale PID file)"
    rm "$PID_FILE"
fi
