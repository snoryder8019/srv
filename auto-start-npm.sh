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