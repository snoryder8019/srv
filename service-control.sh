#!/bin/bash

#######################################################
# Service Control Script
# Quick commands to manage services and monitor
#######################################################

SERVICES=("madladslab" "acm" "ps")
MONITOR_LOG="/srv/monitor-services.log"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to display service status
status() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}         SERVICE STATUS${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    for service in "${SERVICES[@]}"; do
        if tmux has-session -t "$service" 2>/dev/null; then
            echo -e "  ${GREEN}✓${NC} $service - ${GREEN}RUNNING${NC}"
        else
            echo -e "  ${RED}✗${NC} $service - ${RED}DOWN${NC}"
        fi
    done

    echo ""
    echo -e "${BLUE}Monitor Service:${NC}"
    if systemctl is-active --quiet service-monitor.service; then
        echo -e "  ${GREEN}✓${NC} service-monitor - ${GREEN}ACTIVE${NC}"
    else
        echo -e "  ${RED}✗${NC} service-monitor - ${RED}INACTIVE${NC}"
    fi
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Function to start a service
start_service() {
    local service="$1"
    local service_dir="/srv/$service"

    if [ ! -d "$service_dir" ]; then
        echo -e "${RED}Error: Directory not found: $service_dir${NC}"
        return 1
    fi

    echo -e "${YELLOW}Starting $service...${NC}"

    cd "$service_dir"
    tmux new-session -d -s "$service" "npm run dev"

    sleep 2

    if tmux has-session -t "$service" 2>/dev/null; then
        echo -e "${GREEN}✓ $service started successfully${NC}"
    else
        echo -e "${RED}✗ Failed to start $service${NC}"
    fi
}

# Function to stop a service
stop_service() {
    local service="$1"

    echo -e "${YELLOW}Stopping $service...${NC}"
    tmux kill-session -t "$service" 2>/dev/null

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $service stopped${NC}"
    else
        echo -e "${YELLOW}$service was not running${NC}"
    fi
}

# Function to restart a service
restart_service() {
    local service="$1"
    stop_service "$service"
    sleep 2
    start_service "$service"
}

# Function to view logs
view_logs() {
    local service="$1"

    if [ -z "$service" ]; then
        # Show monitor logs
        echo -e "${BLUE}Monitor Logs (last 30 lines):${NC}"
        tail -30 "$MONITOR_LOG"
    else
        # Show service logs
        if tmux has-session -t "$service" 2>/dev/null; then
            echo -e "${BLUE}$service Logs (last 30 lines):${NC}"
            tmux capture-pane -t "$service" -p | tail -30
        else
            echo -e "${RED}$service is not running${NC}"
        fi
    fi
}

# Function to attach to service
attach_service() {
    local service="$1"

    if tmux has-session -t "$service" 2>/dev/null; then
        echo -e "${GREEN}Attaching to $service (Ctrl+B then D to detach)...${NC}"
        sleep 1
        tmux attach-session -t "$service"
    else
        echo -e "${RED}$service is not running${NC}"
    fi
}

# Main menu
show_help() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}        SERVICE CONTROL SCRIPT${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "Usage: $0 [command] [service]"
    echo ""
    echo "Commands:"
    echo "  status                  - Show status of all services"
    echo "  start <service>         - Start a service"
    echo "  stop <service>          - Stop a service"
    echo "  restart <service>       - Restart a service"
    echo "  logs [service]          - View logs (monitor or service)"
    echo "  attach <service>        - Attach to service tmux session"
    echo "  start-all               - Start all services"
    echo "  restart-all             - Restart all services"
    echo "  monitor-start           - Start the monitor service"
    echo "  monitor-stop            - Stop the monitor service"
    echo "  monitor-restart         - Restart the monitor service"
    echo ""
    echo "Services: ${SERVICES[*]}"
    echo ""
    echo "Examples:"
    echo "  $0 status"
    echo "  $0 start madladslab"
    echo "  $0 restart ps"
    echo "  $0 logs madladslab"
    echo "  $0 start-all"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Parse commands
case "$1" in
    status)
        status
        ;;
    start)
        if [ -z "$2" ]; then
            echo -e "${RED}Error: Service name required${NC}"
            show_help
            exit 1
        fi
        start_service "$2"
        ;;
    stop)
        if [ -z "$2" ]; then
            echo -e "${RED}Error: Service name required${NC}"
            show_help
            exit 1
        fi
        stop_service "$2"
        ;;
    restart)
        if [ -z "$2" ]; then
            echo -e "${RED}Error: Service name required${NC}"
            show_help
            exit 1
        fi
        restart_service "$2"
        ;;
    logs)
        view_logs "$2"
        ;;
    attach)
        if [ -z "$2" ]; then
            echo -e "${RED}Error: Service name required${NC}"
            show_help
            exit 1
        fi
        attach_service "$2"
        ;;
    start-all)
        echo -e "${YELLOW}Starting all services...${NC}"
        for service in "${SERVICES[@]}"; do
            start_service "$service"
        done
        echo ""
        status
        ;;
    restart-all)
        echo -e "${YELLOW}Restarting all services...${NC}"
        for service in "${SERVICES[@]}"; do
            restart_service "$service"
        done
        echo ""
        status
        ;;
    monitor-start)
        echo -e "${YELLOW}Starting monitor service...${NC}"
        systemctl start service-monitor.service
        systemctl status service-monitor.service --no-pager -l
        ;;
    monitor-stop)
        echo -e "${YELLOW}Stopping monitor service...${NC}"
        systemctl stop service-monitor.service
        ;;
    monitor-restart)
        echo -e "${YELLOW}Restarting monitor service...${NC}"
        systemctl restart service-monitor.service
        systemctl status service-monitor.service --no-pager -l
        ;;
    *)
        show_help
        ;;
esac
