# Admin/Debug Status Bar

A thin, unobtrusive status bar at the bottom of the page for admins to monitor system health and enable debugging features.

## Features

### 1. System Monitoring
- **CPU Usage**: Real-time CPU usage percentage with color coding
- **Memory Usage**: Real-time memory usage percentage with color coding
- **Service Health**: Green/red indicators for critical services
  - Game State Service
  - MongoDB
  - Other microservices (madladslab, acm, sfg)

### 2. Two Display Modes

#### Compact Mode (Default)
- Thin 24px bar at the bottom
- Shows service indicators, CPU, and memory
- Minimal screen real estate usage

#### Expanded Mode
- Detailed service status with names and ports
- Full system information (uptime, hostname, core count)
- Detailed memory breakdown

### 3. Debug Mode
- Toggle debug mode on the current page
- Visual debugging aids:
  - Element outlines on hover
  - Dashed border around viewport
  - Console logging enhancements
- Debug utilities available via `window.debugUtils`:
  - `debugUtils.logScene()` - Log Three.js scene objects
  - `debugUtils.logPerformance()` - Log memory usage
  - `debugUtils.screenshot()` - Capture Three.js scene

### 4. Service Restart Buttons
- Restart buttons appear next to each service in expanded mode
- Click to restart a service via tmux
- Confirmation dialog before restarting
- Visual feedback (spinning icon → checkmark/error)
- Automatically refreshes status after restart

### 5. Real-time Updates
- Automatically refreshes every 5 seconds
- Manual refresh button in expanded mode
- Color-coded warnings:
  - Green: Normal (< 75%)
  - Yellow: Warning (75-90%)
  - Red: Critical (> 90%)

## Visibility

The status bar is **only visible to admin users**. It checks for `user.isAdmin` in the session.

## API Endpoint

`GET /admin/api/monitor/status`

Returns JSON with:
```json
{
  "success": true,
  "system": {
    "memUsagePercent": 32.8,
    "memUsedMB": 2597,
    "memTotalMB": 7924,
    "cpuUsagePercent": 0.9,
    "cpuCount": 4,
    "uptime": 644956.29,
    "platform": "linux",
    "hostname": "localhost"
  },
  "services": [
    {
      "name": "Game State",
      "status": "healthy",
      "url": "https://svc.madladslab.com"
    },
    {
      "name": "MongoDB",
      "status": "healthy"
    }
  ],
  "timestamp": "2025-10-22T14:17:15.401Z"
}
```

## Usage

1. Log in as an admin user
2. The status bar appears automatically at the bottom of any page
3. Click the expand button (→) to see detailed information
4. Click the debug button (🐞) to toggle debug mode
5. Use the refresh button (↻) in expanded mode to manually update

## Debug Mode Features

When debug mode is enabled:
- **Enhanced Console Logging**: All fetch requests and Socket.IO events are logged
- **Visual Debugging**: Element outlines and bounding boxes
- **Page Information**: Automatic logging of scripts, styles, and global variables
- **Three.js Debugging**: Scene, camera, and renderer information (if applicable)
- **Network Interception**: Logs all fetch requests and responses

### Debug Mode Event

Pages can listen for debug mode changes:

```javascript
window.addEventListener('debugModeChange', function(event) {
  const isEnabled = event.detail.enabled;
  // Your custom debug logic here
});
```

## Files

- `/views/partials/status-bar.ejs` - Status bar HTML and JavaScript
- `/public/stylesheets/status-bar.css` - Status bar styling
- `/public/javascripts/debug-mode.js` - Debug mode utilities
- `/routes/admin/index.js` - Backend API endpoint

## Configuration

### Adding Services to Monitor

Edit `/routes/admin/index.js` and add to the `otherServices` array:

```javascript
const otherServices = [
  { name: 'madladslab', port: 3000 },
  { name: 'acm', port: 3002 },
  { name: 'sfg', port: 3003 },
  { name: 'your-service', port: 3004 }  // Add your service here
];
```

### Adding Restart Capability

To enable restart buttons for a service, add it to the `serviceMap` in the restart endpoint:

```javascript
const serviceMap = {
  'madladslab': { dir: '/srv/madladslab', port: 3000, session: 'madladslab_session' },
  'your-service': { dir: '/srv/your-service', port: 3004, session: 'your_service_session' }
};
```

And update the `serviceIdMap` in `/views/partials/status-bar.ejs`:

```javascript
const serviceIdMap = {
  'madladslab': 'madladslab',
  'your-service': 'your-service'
};
```

## Performance

- Status bar uses minimal resources
- Updates every 5 seconds (configurable)
- Services health checks have 1-2 second timeouts
- No impact on page load time (loaded after main content)

## Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile: Responsive design with compact layout
