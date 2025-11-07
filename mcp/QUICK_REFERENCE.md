# Quick Reference - Claude Custom Connectors

## 🚀 HTTPS Base URL (USE THIS!)
```
https://madladslab.com/api/v1/mcp/
```

## 📱 Quick Test (Try in Browser First!)
```
https://madladslab.com/api/v1/mcp/health
```
Should return: `{"status":"ok",...}`

## 🔥 Most Useful Connectors

### 1. List All Services
```
GET https://madladslab.com/api/v1/mcp/tmux/sessions
```

### 2. Check PS Service (Port 3399)
```
GET https://madladslab.com/api/v1/mcp/service/port/3399
```

### 3. View PS Logs
```
GET https://madladslab.com/api/v1/mcp/tmux/logs/ps?lines=50
```

### 4. Get CLAUDE.md Context
```
GET https://madladslab.com/api/v1/mcp/context/ps
```

## 💬 What to Ask Claude

Once connectors are set up:

```
"Show me all running services"
"Is the ps service up?"
"Get the last 50 lines of logs from ps"
"Read the CLAUDE.md for ps project"
```

## 🔧 Server Commands (if needed)

```bash
# Restart HTTP API
/srv/mcp/start-http.sh

# View logs
tmux attach -t mcp-http

# Stop
tmux kill-session -t mcp-http
```

## ⚡ Test From Command Line

```bash
# Health check
curl https://madladslab.com/api/v1/mcp/health

# All services
curl https://madladslab.com/api/v1/mcp/tmux/sessions

# Read file
curl -X POST https://madladslab.com/api/v1/mcp/read-file \
  -H "Content-Type: application/json" \
  -d '{"path":"/srv/ps/package.json"}'
```

---

**Server Running:** ✅ HTTPS
**Domain:** madladslab.com
**Path:** /api/v1/mcp/
**Service:** madladslab (port 3000)
