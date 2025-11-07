#!/bin/bash

#######################################################
# Service Monitor Script for madladslab, acm, and ps
# Monitors TMUX sessions and restarts if down > 3 minutes
#######################################################

# Configuration
SERVICES=("madladslab" "acm" "ps")
CHECK_INTERVAL=60  # Check every 60 seconds
DOWN_THRESHOLD=180 # Restart if down for 180 seconds (3 minutes)
LOG_FILE="/srv/monitor-services.log"
STATE_DIR="/srv/.service-monitor"

# Create state directory if it doesn't exist
mkdir -p "$STATE_DIR"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Function to check if a tmux session exists
session_exists() {
    local session_name="$1"
    tmux has-session -t "$session_name" 2>/dev/null
    return $?
}

# Function to get service directory
get_service_dir() {
    local service="$1"
    echo "/srv/$service"
}

# Function to start a service
start_service() {
    local service="$1"
    local service_dir=$(get_service_dir "$service")

    log "⚡ Starting service: $service"

    # Check if directory exists
    if [ ! -d "$service_dir" ]; then
        log "❌ ERROR: Directory not found: $service_dir"
        return 1
    fi

    # Kill any existing session (cleanup)
    tmux kill-session -t "$service" 2>/dev/null

    # Wait a moment for cleanup
    sleep 2

    # Start new session
    cd "$service_dir"
    tmux new-session -d -s "$service" "npm run dev"

    if [ $? -eq 0 ]; then
        log "✅ Service started: $service"
        # Clear down time
        rm -f "$STATE_DIR/${service}.down"
        return 0
    else
        log "❌ Failed to start service: $service"
        return 1
    fi
}

# Function to check and restart service if needed
check_service() {
    local service="$1"
    local state_file="$STATE_DIR/${service}.down"
    local current_time=$(date +%s)

    if session_exists "$service"; then
        # Service is running
        if [ -f "$state_file" ]; then
            # Service was down but is now up, clear state
            log "✅ Service recovered: $service"
            rm -f "$state_file"
        fi
    else
        # Service is down
        if [ -f "$state_file" ]; then
            # Service was already down, check how long
            local down_since=$(cat "$state_file")
            local down_duration=$((current_time - down_since))

            log "⚠️  Service $service down for ${down_duration}s (threshold: ${DOWN_THRESHOLD}s)"

            if [ $down_duration -ge $DOWN_THRESHOLD ]; then
                # Down for too long, restart
                log "🔄 Service $service exceeded down threshold, restarting..."
                start_service "$service"
            fi
        else
            # Service just went down, record the time
            echo "$current_time" > "$state_file"
            log "⚠️  Service detected down: $service (started monitoring)"
        fi
    fi
}

# Main monitoring loop
main() {
    log "🚀 Service Monitor Started"
    log "📋 Monitoring services: ${SERVICES[*]}"
    log "⏱️  Check interval: ${CHECK_INTERVAL}s"
    log "⏳ Down threshold: ${DOWN_THRESHOLD}s"

    while true; do
        for service in "${SERVICES[@]}"; do
            check_service "$service"
        done

        sleep "$CHECK_INTERVAL"
    done
}

# Handle signals for graceful shutdown
trap 'log "🛑 Service Monitor Stopped"; exit 0' SIGINT SIGTERM

# Run main function
main
