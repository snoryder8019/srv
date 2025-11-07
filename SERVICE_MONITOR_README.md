# Service Monitor Documentation

## Overview

Automatic service monitoring and recovery system for madladslab, acm, and ps services.

## Components

### 1. Monitor Service (`service-monitor.service`)
- **Location**: `/etc/systemd/system/service-monitor.service`
- **Status**: `systemctl status service-monitor.service`
- **Auto-starts on boot**: Yes
- **Monitoring interval**: Every 60 seconds
- **Restart threshold**: 3 minutes (180 seconds)

### 2. Monitor Script (`monitor-services.sh`)
- **Location**: `/srv/monitor-services.sh`
- **Log file**: `/srv/monitor-services.log`
- **State directory**: `/srv/.service-monitor/`

### 3. Control Script (`service-control.sh`)
- **Location**: `/srv/service-control.sh`
- **Quick manual control of services**

## How It Works

1. **Monitoring**: The monitor checks all 3 services every 60 seconds
2. **Detection**: If a service is down, it records the time
3. **Grace Period**: Services have 3 minutes to recover on their own
4. **Auto-Restart**: After 3 minutes down, the monitor automatically restarts the service
5. **Never uses `killall node`**: Only uses TMUX session management

## Quick Commands

### Check Status
```bash
/srv/service-control.sh status
```

### Start/Stop/Restart Individual Service
```bash
/srv/service-control.sh start madladslab
/srv/service-control.sh stop acm
/srv/service-control.sh restart ps
```

### Start/Restart All Services
```bash
/srv/service-control.sh start-all
/srv/service-control.sh restart-all
```

### View Logs
```bash
# Monitor logs
/srv/service-control.sh logs

# Service logs
/srv/service-control.sh logs madladslab
/srv/service-control.sh logs acm
/srv/service-control.sh logs ps
```

### Attach to Service (Live View)
```bash
/srv/service-control.sh attach madladslab
# Press Ctrl+B then D to detach
```

### Monitor Service Control
```bash
# Start monitor
systemctl start service-monitor.service

# Stop monitor
systemctl stop service-monitor.service

# Restart monitor
systemctl restart service-monitor.service

# View monitor status
systemctl status service-monitor.service

# View monitor logs (systemd)
journalctl -u service-monitor.service -f

# View monitor logs (file)
tail -f /srv/monitor-services.log
```

## Configuration

### Change Monitoring Settings
Edit `/srv/monitor-services.sh`:

```bash
CHECK_INTERVAL=60      # How often to check (seconds)
DOWN_THRESHOLD=180     # How long before restart (seconds)
```

Then restart the monitor:
```bash
systemctl restart service-monitor.service
```

### Add New Services to Monitor
Edit `/srv/monitor-services.sh`:

```bash
SERVICES=("madladslab" "acm" "ps" "new_service")
```

Edit `/srv/service-control.sh`:

```bash
SERVICES=("madladslab" "acm" "ps" "new_service")
```

Then restart:
```bash
systemctl restart service-monitor.service
```

## Log Files

### Monitor Log
- **Location**: `/srv/monitor-services.log`
- **Contains**: All monitoring events, service starts/stops
- **View**: `tail -f /srv/monitor-services.log`

### Service State Files
- **Location**: `/srv/.service-monitor/`
- **Files**: `<service>.down` files track when services go down
- **Automatic cleanup**: Removed when service recovers

## Troubleshooting

### Monitor not starting services
1. Check monitor is running: `systemctl status service-monitor.service`
2. Check monitor logs: `tail /srv/monitor-services.log`
3. Verify service directories exist: `ls -la /srv/madladslab /srv/acm /srv/ps`
4. Check permissions: `ls -la /srv/monitor-services.sh`

### Service keeps crashing
1. Check service logs: `/srv/service-control.sh logs <service>`
2. Manually start to see errors: `cd /srv/<service> && npm run dev`
3. Check for port conflicts, missing dependencies, etc.

### Disable auto-restart for maintenance
```bash
# Stop the monitor temporarily
systemctl stop service-monitor.service

# Do your maintenance...

# Start monitor again
systemctl start service-monitor.service
```

## Safety Features

- ✅ **No `killall node`**: Uses TMUX session management only
- ✅ **Grace period**: 3 minutes before auto-restart
- ✅ **State tracking**: Knows when services went down
- ✅ **Logging**: All actions logged with timestamps
- ✅ **Service isolation**: Each service in its own TMUX session
- ✅ **Auto-recovery**: Automatically restarts on system reboot

## Integration with Claude Vision

The service monitor works seamlessly with Claude Vision:
- View services at: `/claudeTalk/sessions`
- Manual control through web interface
- Monitor logs visible in Sessions view
- All operations respect TMUX session structure

## Example Monitor Log

```
[2025-11-06 17:04:30] 🚀 Service Monitor Started
[2025-11-06 17:04:30] 📋 Monitoring services: madladslab acm ps
[2025-11-06 17:04:30] ⚠️  Service detected down: acm (started monitoring)
[2025-11-06 17:07:30] ⚠️  Service acm down for 180s (threshold: 180s)
[2025-11-06 17:07:30] 🔄 Service acm exceeded down threshold, restarting...
[2025-11-06 17:07:30] ⚡ Starting service: acm
[2025-11-06 17:07:32] ✅ Service started: acm
```
