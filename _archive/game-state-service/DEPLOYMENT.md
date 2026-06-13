# Game State Service - Deployment Guide

## ✅ Service Status

**Running:** Port 3500
**PID:** 235073
**URL:** http://104.237.138.28:3500
**CORS:** Configured for PS app

## 🚀 Quick Start

### Start Service
```bash
cd /srv/game-state-service
node index.js > /tmp/game-state.log 2>&1 &
```

### Check Health
```bash
curl http://104.237.138.28:3500/health
```

### View Logs
```bash
tail -f /tmp/game-state.log
```

### Stop Service
```bash
pkill -f "node index.js"
```

## 🔧 Configuration

### Environment Variables (.env)
```
PORT=3500
NODE_ENV=development
CORS_ORIGIN=http://localhost:3399,http://ps.madladslab.com,http://104.237.138.28:3399,http://104.237.138.28
```

### CORS Origins
- localhost:3399 (development)
- ps.madladslab.com (production domain)
- 104.237.138.28:3399 (direct IP)
- 104.237.138.28 (direct IP without port)

## 📡 API Endpoints

### REST APIs
```
GET /health                      - Service health check
GET /api/state                   - Complete game state
GET /api/state/galactic          - Galactic state only
GET /api/state/events            - Active events
GET /api/state/factions          - Faction standings
GET /api/state/planetary         - Planetary zones (chunked)
```

### Test Endpoints
```bash
# Health
curl http://104.237.138.28:3500/health

# Galactic State
curl http://104.237.138.28:3500/api/state/galactic

# Events
curl http://104.237.138.28:3500/api/state/events

# Full State
curl http://104.237.138.28:3500/api/state
```

## 🌐 Frontend Integration

### PS App Route
```
http://ps.madladslab.com/universe/galactic-state
http://104.237.138.28:3399/universe/galactic-state
```

### Polling Configuration
- **State Updates:** Every 5 seconds
- **Event Updates:** Every 10 seconds
- **Service Updates:** Every 30 seconds (internal)
- **New Events Generated:** Every 2 minutes

## 🔍 Troubleshooting

### Service Not Responding
```bash
# Check if running
ps aux | grep "node index.js"

# Check logs
tail -50 /tmp/game-state.log

# Restart service
pkill -f "node index.js"
cd /srv/game-state-service && node index.js > /tmp/game-state.log 2>&1 &
```

### CORS Errors
```bash
# Verify CORS headers
curl -I http://104.237.138.28:3500/api/state | grep -i "access-control"

# Should see:
# Access-Control-Allow-Origin: http://104.237.138.28:3399
# Access-Control-Allow-Credentials: true
```

### Frontend Not Populating
1. Check browser console for errors
2. Verify service is running: `curl http://104.237.138.28:3500/health`
3. Check CORS headers are present
4. Clear browser cache and reload

## 📊 Data Simulation

### State Updates (Every 30s)
- Faction power: ±1.5 adjustment
- Resources: Incremental increases
- Zone discovery: 30% chance
- Dominant faction: Recalculated

### Event Generation (Every 2min)
- Types: discovery, conflict, economic, environmental
- Severity: low, medium, high
- Random templates with dynamic content
- Last 20 events stored

### Planetary Zones
- Total: 500 zones generated
- Chunked delivery: 50 zones per request
- Properties: type, climate, controller, resources, danger level

## 🔄 Auto-Restart (Systemd)

Create service file:
```bash
sudo nano /etc/systemd/system/game-state.service
```

Content:
```ini
[Unit]
Description=Game State Microservice
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/srv/game-state-service
ExecStart=/usr/bin/node index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PORT=3500

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable game-state
sudo systemctl start game-state
sudo systemctl status game-state
```

View logs:
```bash
sudo journalctl -u game-state -f
```

## 📈 Performance

### Resource Usage
- **Memory:** ~75 MB
- **CPU:** < 1% (idle)
- **Network:** Minimal (REST polling)

### Scalability
- Handles multiple concurrent connections
- Stateless design (can run multiple instances)
- No database required (generates on-the-fly)

## 🎯 Frontend Features

Users see:
- ✅ Live galactic overview (year, cycle, season)
- ✅ Faction power bars (animated)
- ✅ Resource counters (energy, minerals, tech, population)
- ✅ Live events feed (scrollable)
- ✅ Connection status indicator

Updates automatically:
- ✅ Polls every 5 seconds
- ✅ Smooth animations
- ✅ No page refresh needed
- ✅ Connection status monitoring

## 🛡️ Security Notes

- CORS restricted to known origins
- No authentication required (read-only data)
- Rate limiting could be added for production
- Consider HTTPS in production

## 📝 Maintenance

### Update Service
```bash
cd /srv/game-state-service
# Make changes to code
pkill -f "node index.js"
node index.js > /tmp/game-state.log 2>&1 &
```

### Monitor Performance
```bash
# Check process
top -p $(pgrep -f "node index.js")

# Check memory
ps aux | grep "node index.js"

# Check connections
netstat -an | grep 3500
```

---

**Status:** ✅ Running and serving data
**Last Updated:** 2025-10-21
**Version:** 1.0.0
