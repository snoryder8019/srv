# Claude Browser - Custom Connector Setup

## ✅ HTTP API Status
- **Server:** Running on port 3600
- **External URL:** `http://104.237.138.28:3600`
- **Health Check:** http://104.237.138.28:3600/health
- **Session:** `mcp-http` (tmux)

## 📱 Browser Setup (Mobile or Desktop)

### Step 1: Open Claude in Browser
1. Go to https://claude.ai on your phone browser
2. Log in to your account
3. Click the settings icon (⚙️)
4. Look for "Integrations" or "Custom Connectors" option
5. Click "Add Custom Connector"

### Step 2: Available API Endpoints

Here are the key endpoints you can configure as Custom Connectors:

#### 🔍 **Check Service Status**
```
GET http://104.237.138.28:3600/api/tmux/sessions
```
Returns list of all tmux sessions and their status.

#### 📋 **Get Session Logs**
```
GET http://104.237.138.28:3600/api/tmux/logs/{session_name}?lines=100
```
Example: `http://104.237.138.28:3600/api/tmux/logs/ps?lines=50`

#### 🔌 **Check Port Status**
```
GET http://104.237.138.28:3600/api/service/port/{port}
```
Example: `http://104.237.138.28:3600/api/service/port/3399`

#### 📂 **Read File**
```
POST http://104.237.138.28:3600/api/read-file
Content-Type: application/json

{
  "path": "/srv/ps/docs/CLAUDE.md"
}
```

#### 📝 **List Directory**
```
POST http://104.237.138.28:3600/api/list-directory
Content-Type: application/json

{
  "path": "/srv/ps"
}
```

#### ⚡ **Execute Command**
```
POST http://104.237.138.28:3600/api/execute
Content-Type: application/json

{
  "command": "ps aux | grep node",
  "timeout": 30000
}
```

#### 📖 **Get Project Context**
```
GET http://104.237.138.28:3600/api/context/ps
```
Returns the CLAUDE.md file for the project.

### Step 3: Example Custom Connector Configuration

When adding a connector, you might configure it like this:

**Name:** Check PS Service
**URL:** `http://104.237.138.28:3600/api/service/port/3399`
**Method:** GET
**Description:** Check if Stringborn Universe service is running

**Name:** Get PS Logs
**URL:** `http://104.237.138.28:3600/api/tmux/logs/ps`
**Method:** GET
**Description:** View recent logs from PS service

**Name:** List Services
**URL:** `http://104.237.138.28:3600/api/tmux/sessions`
**Method:** GET
**Description:** Show all service statuses

### Step 4: Test the Connection

Try asking Claude:
```
"Use the List Services connector to show me what's running"
"Check the status of the PS service on port 3399"
"Read the CLAUDE.md file for the ps project"
```

## 🎯 What You Can Ask Claude To Do

### Check Status
```
"Show me all running services"
"Is the ps service running on port 3399?"
"What's the status of madladslab?"
```

### View Logs
```
"Show me the last 50 lines from the ps service"
"What are the recent logs from game-state?"
```

### File Operations
```
"Read the file /srv/ps/package.json"
"List files in /srv/ps/docs"
"Show me the CLAUDE.md context"
```

### Execute Commands
```
"Check how much memory is being used"
"List all node processes"
"Show disk usage for /srv"
```

## 🚨 Safety Features

The API has built-in protections:

❌ **Blocks dangerous commands:**
- `killall` - Would kill all services
- `rm -rf /` - Destructive
- `reboot` / `shutdown` - System commands
- Any operations outside `/srv`

✅ **Safe operations:**
- Reading files in `/srv`
- Listing directories
- Checking service status
- Viewing logs
- Safe command execution with timeout

## 🐛 Troubleshooting

### "Connection failed" or timeout

**Check 1: Is HTTP server running?**
```bash
tmux ls | grep mcp-http
```

**Check 2: Can you reach the server?**
Test in browser: http://104.237.138.28:3600/health

Should return:
```json
{
  "status": "ok",
  "timestamp": "2025-11-06T..."
}
```

**Check 3: Restart HTTP server**
```bash
/srv/mcp/start-http.sh
```

**Check 4: View logs**
```bash
tmux attach -t mcp-http
# Press Ctrl+B, then D to detach
```

### Firewall Issues

If you can't connect, you may need to open port 3600:

```bash
# Check if firewall is active
sudo ufw status

# Allow port 3600 (if using ufw)
sudo ufw allow 3600/tcp

# Or check iptables
sudo iptables -L -n | grep 3600
```

### API Returns Errors

All API responses include error messages:
```json
{
  "error": "Access denied: Path must be within /srv"
}
```

Common errors:
- **403**: Trying to access files outside `/srv`
- **404**: File or endpoint not found
- **413**: File too large (max 10MB)
- **500**: Command failed or forbidden

## 📊 API Reference

### GET Endpoints
| Endpoint | Description | Parameters |
|----------|-------------|------------|
| `/health` | Health check | None |
| `/api/tmux/sessions` | List all sessions | None |
| `/api/tmux/session/:name` | Session details | `name` = session name |
| `/api/tmux/logs/:name` | Session logs | `name`, `lines` (query) |
| `/api/service/port/:port` | Check port status | `port` |
| `/api/context` | Get CLAUDE.md | `project` (query, default: ps) |
| `/api/context/:project` | Get CLAUDE.md | `project` |

### POST Endpoints
| Endpoint | Body | Description |
|----------|------|-------------|
| `/api/read-file` | `{ path }` | Read file contents |
| `/api/write-file` | `{ path, content }` | Write to file |
| `/api/list-directory` | `{ path }` | List directory |
| `/api/execute` | `{ command, timeout? }` | Execute bash command |

## 🔧 Server Management

### View HTTP Server Logs
```bash
tmux attach -t mcp-http
```

### Restart HTTP Server
```bash
/srv/mcp/start-http.sh
```

### Stop HTTP Server
```bash
tmux kill-session -t mcp-http
```

### Change Port
```bash
HTTP_PORT=3601 /srv/mcp/start-http.sh
```

## 🎓 Pro Tips

1. **Test endpoints directly first:**
   Use your phone browser to visit:
   http://104.237.138.28:3600/health

2. **Start simple:**
   Begin with GET endpoints (sessions, port status) before POST

3. **Use meaningful connector names:**
   "Check PS Status" is better than "API Call 1"

4. **Check logs when debugging:**
   ```bash
   tmux attach -t mcp-http
   ```

5. **The stdio MCP server is still running:**
   This HTTP API is a separate service that wraps the same functionality

## 📞 Need Help?

**From your computer:**
```bash
# SSH to VM
ssh root@104.237.138.28

# Check HTTP server
tmux attach -t mcp-http

# Check all services
tmux ls
```

**From browser:**
Visit http://104.237.138.28:3600/health to verify server is up.

---

**Setup Complete!** You can now use Claude in your browser with Custom Connectors to manage your VM services.
