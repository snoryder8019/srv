# Claude Mobile - Setup Guide

## 🚨 IMPORTANT: MCP vs Custom Connectors

### Native MCP (NOT Available)
- ❌ Claude Android App - **No MCP support**
- ❌ Claude iOS App - **No MCP support**
- ✅ Claude Desktop App - **Has MCP support**
- ✅ Claude Code (VS Code) - **Has MCP support**

### Custom Connectors (Available in Browser!)
- ✅ Claude in mobile browser (claude.ai) - **Has Custom Connectors**
- ✅ Claude in desktop browser - **Has Custom Connectors**

## 📱 Use Browser Custom Connectors Instead!

**See:** [CUSTOM_CONNECTORS.md](CUSTOM_CONNECTORS.md) for full instructions.

**Quick Start:**
1. Go to https://claude.ai in your phone browser
2. Settings → Integrations → Custom Connectors
3. Add connector: `https://madladslab.com/api/v1/mcp/tmux/sessions`

**Test it works:** Open https://madladslab.com/api/v1/mcp/health in your browser

---

## 🖥️ Claude Desktop App (MCP - For Reference Only)

If you're using Claude Desktop on a computer, here's the MCP config:

## ✅ Server Status
- **Location:** `/srv/mcp`
- **Status:** Running in tmux session `mcp-server`
- **Transport:** stdio (via SSH)

### Desktop Configuration

**Location:**
- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

### Step 2: Add Server Configuration

**Method A: SSH with Password**
```json
{
  "mcpServers": {
    "srv-manager": {
      "command": "ssh",
      "args": [
        "root@YOUR_VM_IP",
        "cd /srv/mcp && node server.js"
      ],
      "transport": "stdio"
    }
  }
}
```

**Method B: SSH with Key (if configured)**
```json
{
  "mcpServers": {
    "srv-manager": {
      "command": "ssh",
      "args": [
        "-i", "/path/to/key",
        "root@YOUR_VM_IP",
        "cd /srv/mcp && node server.js"
      ],
      "transport": "stdio"
    }
  }
}
```

**Replace:**
- `YOUR_VM_IP` with your actual VM IP address
- `/path/to/key` with path to SSH key on Android device (if using key auth)

### Step 3: Test Connection

Ask Claude in the Android app:
```
"List all tmux sessions on the server"
```

Expected response:
- Should show list of running sessions (ps, madladslab, game-state, mcp-server, etc.)
- Should indicate which are running/stopped

### Step 4: Load Context

Ask Claude:
```
"Read the CLAUDE.md file for the ps project so you know the current state"
```

Expected response:
- Should load `/srv/ps/docs/CLAUDE.md`
- Claude will understand the project structure, services, and safety rules

## 🎯 What You Can Do

### Check Service Status
```
"Check if the ps service is running on port 3399"
"What tmux sessions are currently active?"
"Show me the status of the madladslab service"
```

### View Logs
```
"Show me the last 50 lines from the ps session"
"Capture recent logs from the mcp-server"
```

### Restart Services (Safely!)
```
"The ps service seems stuck, restart it safely"
"Restart the madladslab service without affecting others"
```

### File Operations
```
"Read the file /srv/ps/package.json"
"Show me what's in the /srv/ps/docs directory"
```

### Emergency Actions
```
"Everything is broken, run the emergency restart script"
```
(This runs `/srv/start-all-services.sh`)

## 🚨 What Claude WILL NOT Do

The MCP server enforces these safety rules:

❌ **Will reject:**
- `killall node` - Would kill ALL services
- `rm -rf /` - Destructive commands
- `reboot`, `shutdown` - System commands
- Anything outside `/srv` directory

✅ **Will use instead:**
- `tmux kill-session -t SESSION` - Safe service stop
- `lsof -ti:PORT | xargs kill -9` - Port-specific kills
- `/srv/start-all-services.sh` - Safe full restart

## 🐛 Troubleshooting

### "Connection failed" or "Server not responding"

**Check 1: Is MCP server running?**
```bash
# On VM
tmux ls | grep mcp-server
```

**Check 2: Can you SSH from Android?**
Test SSH connection manually first:
```bash
ssh root@YOUR_VM_IP
```

**Check 3: Restart MCP server**
```bash
# On VM
cd /srv/mcp
./start-mcp.sh
```

### "Command timed out"

Long commands have 30s timeout. Try:
```
"Execute this command with 60 second timeout: [command]"
```

### "Access denied"

Files must be in `/srv` directory. Check the path:
```
"List the contents of /srv to see what's available"
```

## 📊 Server Info

### VM Details
- **Services Directory:** `/srv`
- **MCP Server:** `/srv/mcp`
- **Main Project:** `/srv/ps` (Stringborn Universe)
- **Lab Projects:** `/srv/madladslab`

### Known Services
| Name | Port | Description |
|------|------|-------------|
| ps | 3399 | Stringborn Universe |
| game-state | 3500 | Game state service |
| madladslab | 3000 | Main lab service |
| mcp-server | - | This MCP server |

### Important Files
- `/srv/ps/docs/CLAUDE.md` - Main project context
- `/srv/start-all-services.sh` - Emergency restart
- `/srv/mcp/CLAUDE_MCP.md` - MCP documentation

## 🎓 Pro Tips

1. **Always load context first:**
   ```
   "Read CLAUDE.md to understand the project"
   ```

2. **Check before restarting:**
   ```
   "Check all service statuses before we restart anything"
   ```

3. **View logs when debugging:**
   ```
   "Show me recent logs from the ps session to debug this issue"
   ```

4. **Use tmux session names:**
   ```
   "Restart the ps tmux session" (not "restart node")
   ```

5. **Emergency only:**
   Only use emergency restart when necessary - it restarts ALL services

## 📞 Need Help?

**On the VM:**
```bash
# View MCP server logs
tmux attach -t mcp-server

# Detach: Ctrl+B, then D

# Restart MCP server
cd /srv/mcp && ./start-mcp.sh

# Stop MCP server
tmux kill-session -t mcp-server
```

**From Android:**
```
"Help me troubleshoot the MCP connection"
```

---

**Setup Complete!** Your Claude Android app can now safely manage your VM services.
