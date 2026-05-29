#!/bin/bash

# Path to the JSON config file
CONFIG_FILE="/srv/auto-start-npm.json"
LOG_FILE="/srv/auto-start-npm.log"

# Clear the log file on each start
> "$LOG_FILE"

echo "========================================" >> "$LOG_FILE"
echo "Auto-start script started at $(date)" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "ERROR: jq is not installed. Please install it first." >> "$LOG_FILE"
    echo "Run: apt-get install jq" >> "$LOG_FILE"
    exit 1
fi

# Check if config file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "ERROR: Config file $CONFIG_FILE not found!" >> "$LOG_FILE"
    exit 1
fi

# Kill existing sessions first (optional - comment out if you don't want this)
echo "" >> "$LOG_FILE"
echo "Checking for existing tmux sessions..." >> "$LOG_FILE"
jq -r 'keys[]' "$CONFIG_FILE" | while read -r dir; do
    session_name="${dir}_session"
    if tmux has-session -t "$session_name" 2>/dev/null; then
        echo "Killing existing session: $session_name" >> "$LOG_FILE"
        tmux kill-session -t "$session_name" 2>&1 >> "$LOG_FILE"
    fi
done

# Wait a moment for sessions to fully terminate
sleep 1

echo "" >> "$LOG_FILE"
echo "Starting new tmux sessions..." >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Use jq to parse JSON and iterate over each key-value pair
jq -r 'to_entries[] | "\(.key) \(.value)"' "$CONFIG_FILE" | while read -r dir cmd; do
    # Trim whitespace
    dir=$(echo "$dir" | xargs)
    cmd=$(echo "$cmd" | xargs)

    # Build the full directory path
    full_dir="/srv/$dir"

    # Check if the directory exists
    if [ -d "$full_dir" ]; then
        # Check if package.json exists
        if [ -f "$full_dir/package.json" ]; then
            session_name="${dir}_session"
            echo "✓ Starting tmux session '$session_name'" >> "$LOG_FILE"
            echo "  Directory: $full_dir" >> "$LOG_FILE"
            echo "  Command: $cmd" >> "$LOG_FILE"

            # Start a new tmux session and run the command inside it
            tmux new-session -d -s "$session_name" -c "$full_dir" "$cmd" 2>&1

            # Verify the session was created
            if tmux has-session -t "$session_name" 2>/dev/null; then
                echo "  Status: SUCCESS" >> "$LOG_FILE"
            else
                echo "  Status: FAILED" >> "$LOG_FILE"
            fi
            echo "" >> "$LOG_FILE"
        else
            echo "✗ Skipping $dir: package.json not found" >> "$LOG_FILE"
            echo "" >> "$LOG_FILE"
        fi
    else
        echo "✗ Skipping $dir: Directory $full_dir does not exist" >> "$LOG_FILE"
        echo "" >> "$LOG_FILE"
    fi
done

# ── Special case: MCP HTTP streamable server ──────────────────────
# The JSON loop above starts the stdio MCP server (key "mcp" -> mcp_session
# via `npm start` -> node server.js, used by Android/SSH). The HTTP streamable
# server needs a custom session name + command that the key-derived loop can't
# express, so start it explicitly here. Session/cmd MUST match
# service-watchdog.json so the watchdog doesn't spawn a duplicate.
echo "" >> "$LOG_FILE"
if tmux has-session -t "mcp-streamable" 2>/dev/null; then
    tmux kill-session -t "mcp-streamable" 2>&1 >> "$LOG_FILE"
    sleep 1
fi
tmux new-session -d -s "mcp-streamable" -c "/srv/mcp" "node mcp-http.js" 2>&1
if tmux has-session -t "mcp-streamable" 2>/dev/null; then
    echo "✓ Started tmux session 'mcp-streamable' (node mcp-http.js, port 3650)" >> "$LOG_FILE"
else
    echo "✗ FAILED to start 'mcp-streamable'" >> "$LOG_FILE"
fi

# ── Special case: mllOauth (OAuth 2.1 AS for the MCP resource) ────
# Custom session name + command, so the key-derived loop can't express it.
# Must match service-watchdog.json so the watchdog doesn't spawn a duplicate.
if tmux has-session -t "mllOauth" 2>/dev/null; then
    tmux kill-session -t "mllOauth" 2>&1 >> "$LOG_FILE"
    sleep 1
fi
tmux new-session -d -s "mllOauth" -c "/srv/mllOauth" "node server.js" 2>&1
if tmux has-session -t "mllOauth" 2>/dev/null; then
    echo "✓ Started tmux session 'mllOauth' (node server.js, port 3651)" >> "$LOG_FILE"
else
    echo "✗ FAILED to start 'mllOauth'" >> "$LOG_FILE"
fi

echo "========================================" >> "$LOG_FILE"
echo "Auto-start script completed at $(date)" >> "$LOG_FILE"
echo "========================================" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
echo "Active tmux sessions:" >> "$LOG_FILE"
tmux list-sessions 2>&1 >> "$LOG_FILE"

# Display summary to console
echo "Auto-start script completed. Check $LOG_FILE for details."
echo ""
echo "Active tmux sessions:"
tmux list-sessions 2>&1 || echo "No active sessions"