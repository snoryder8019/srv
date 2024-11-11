#!/bin/bash

# Path to the JSON config file
CONFIG_FILE="/srv/auto-start-npm.json"
LOG_FILE="/srv/auto-start-npm.log"

# Clear the log file on each start
> "$LOG_FILE"

# Use jq to parse JSON and iterate over each key-value pair
jq -r 'to_entries[] | "\(.key) \(.value)"' "$CONFIG_FILE" | while read -r dir cmd; do
    # Trim whitespace
    dir=$(echo "$dir" | xargs)
    cmd=$(echo "$cmd" | xargs)

    # Build the full directory path
    full_dir="/srv/$dir"

    # Check if the directory exists
    if [ -d "$full_dir" ]; then
        session_name="${dir}_session"
        echo "Starting tmux session '$session_name' for command in $full_dir: $cmd" >> "$LOG_FILE"

        # Start a new tmux session and run the command inside it
        tmux new-session -d -s "$session_name" -c "$full_dir" "$cmd" >> "$LOG_FILE" 2>&1
    else
        echo "Directory $full_dir does not exist, skipping." >> "$LOG_FILE"
    fi
done
