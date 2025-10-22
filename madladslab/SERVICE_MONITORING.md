# Service Monitoring System

## Overview

The MadLadsLab Service Monitoring system automatically monitors all services running in `/srv` and sends email alerts when services go down or recover.

## Features

- **Real-time Monitoring**: Checks all services every 60 seconds
- **Email Alerts**: Sends detailed emails when services go down or recover
- **Alert Cooldown**: Prevents spam by limiting alerts to once every 5 minutes
- **Status Logging**: Stores service status history in MongoDB
- **Uptime Statistics**: Calculate uptime percentages and downtime incidents
- **Admin Dashboard**: View real-time status at `/admin/monitor`

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
ZOHO_USER=your-email@yourdomain.com
ZOHO_PASS=your-app-specific-password
ALERT_EMAIL=admin@yourdomain.com
ENABLE_SERVICE_MONITOR=true  # Set to false to disable
```

### Monitored Services

The system automatically monitors these services:

- **madladslab** (Port 3000) - madladslab.com
- **madThree** (Port 3003) - three.madladslab.com
- **ps** (Port 3399) - ps.madladslab.com
- **sfg** (Port 3002) - sfg.madladslab.com
- **sna** (Port 3005) - somenewsarticle.com
- **twww** (Port 3006) - theworldwidewallet.com
- **acm** (Port 3004) - acmcreativeconcepts.com
- **w2MongoClient** (Port 3007) - localhost
- **nocometalworkz** (Port 3008) - nocometalworkz.com

## How It Works

### Service Status Checks

For each service, the system checks:

1. **Tmux Session**: Is the process running in tmux?
2. **Port Listening**: Is the port open and listening?
3. **Health Check**: Does HTTP request to localhost:PORT return a valid response?
4. **Resource Usage**: CPU and memory usage

### Alert Conditions

**Service Down Alert** is sent when:
- Service status changes from `healthy` to `unhealthy` or `stopped`
- Service remains down after cooldown period (5 minutes)

**Service Recovery Alert** is sent when:
- Service status changes from `unhealthy/stopped` back to `healthy`

### Email Notifications

Emails include:
- Service name and domain
- Current status and timestamp
- Process running status
- Port listening status
- Health check results
- Error details (if any)
- Link to admin dashboard

## API Endpoints

All endpoints require admin authentication.

### Get All Apps Status
```
GET /admin/monitor/api/apps
```

### Get Single App Status
```
GET /admin/monitor/api/apps/:appName
```

### Get Service History
```
GET /admin/monitor/api/history/:serviceName?limit=100
```

### Get Downtime Statistics
```
GET /admin/monitor/api/stats/:serviceName?days=7
```

### Get Daemon Status
```
GET /admin/monitor/api/daemon/status
```

### Restart App
```
POST /admin/monitor/api/restart/:appName
```

## Testing

Run the test script to verify email notifications:

```bash
node test-service-monitor.js
```

This will:
1. Check the status of all services
2. Send a test email for any down service (or simulate one)
3. Verify Zoho SMTP configuration

## Database

### Collection: `service_monitor_logs`

Stores service status history with fields:
- `serviceName`: Name of the service
- `status`: healthy, unhealthy, stopped, error
- `running`: Boolean - is process running
- `port`: Port number
- `domain`: Domain name
- `health`: Health check data
- `timestamp`: When the check occurred
- `details`: Additional diagnostic info

### Querying Logs

Using the ServiceMonitorLog model:

```javascript
import ServiceMonitorLog from './api/v1/models/ServiceMonitorLog.js';

const model = new ServiceMonitorLog();

// Get recent logs for a service
const history = await model.getServiceHistory('madladslab', 100);

// Get downtime statistics
const stats = await model.getDowntimeStats('madladslab', 7);

// Clean up old logs (older than 30 days)
await model.cleanupOldLogs(30);
```

## Files

- **`/lib/serviceMonitorDaemon.js`** - Main monitoring daemon
- **`/lib/systemMonitor.js`** - Service status checking utilities
- **`/api/v1/models/ServiceMonitorLog.js`** - Database model
- **`/routes/admin/index.js`** - API endpoints
- **`/views/admin/monitor.ejs`** - Admin dashboard UI
- **`/bin/www`** - Server startup (includes daemon initialization)

## Customization

### Change Check Interval

Edit `/lib/serviceMonitorDaemon.js`:

```javascript
const CHECK_INTERVAL = 60000; // 60 seconds (change as needed)
```

### Change Alert Cooldown

```javascript
const ALERT_COOLDOWN = 300000; // 5 minutes (change as needed)
```

### Add New Services

Edit `/lib/systemMonitor.js` APP_CONFIG:

```javascript
const APP_CONFIG = {
  myNewApp: {
    port: 3009,
    path: '/srv/myNewApp',
    domain: 'mynewapp.com'
  }
};
```

## Troubleshooting

### No Emails Received

1. Check Zoho credentials in `.env`
2. Verify `ALERT_EMAIL` is set correctly
3. Check spam folder
4. Run test script: `node test-service-monitor.js`
5. Check server logs for errors

### False Alerts

- Service may be slow to respond (timeout is 5 seconds)
- Adjust health check timeout in `systemMonitor.js`
- Check service logs for actual issues

### Monitoring Not Running

1. Check `ENABLE_SERVICE_MONITOR` in `.env`
2. Restart the madladslab service
3. Check logs: `tmux capture-pane -t madladslab_session -p`

## Support

For issues or questions:
- Check logs in `/admin/monitor`
- Review MongoDB logs collection
- Contact: scott@madladslab.com
