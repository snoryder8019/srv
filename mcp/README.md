# MCP Server for /srv VM Management

**Purpose:** Allow Claude to safely manage VM services, read files, execute commands, and monitor tmux sessions.

---

## 🎯 **QUICK START - Mobile Users**

### ✅ Use Custom Connectors (Browser - RECOMMENDED)
**HTTPS API is live and ready to use!**

1. Open **https://claude.ai** in your phone browser
2. Go to **Settings** → **Integrations** → **Custom Connectors**
3. Add: `https://madladslab.com/api/v1/mcp/tmux/sessions`

**📖 Full Guide:** [CUSTOM_CONNECTORS.md](CUSTOM_CONNECTORS.md)

**Test Now:** https://madladslab.com/api/v1/mcp/health

---

### ❌ Native MCP (Desktop Only - Not for Mobile)
MCP is only available in:
- Claude Desktop App (Windows/Mac)
- Claude Code (VS Code)

**NOT available in:** Claude Android/iOS apps

---

## 🚨 Critical Safety Rules

This MCP server enforces the following safety rules from [CLAUDE.md](/srv/ps/docs/CLAUDE.md):

1. **NEVER use `killall node`** - Kills ALL services on the VM!
2. **ALWAYS use tmux session management** for service control
3. **Use `/srv/start-all-services.sh`** for full restart fallback
4. **Use `lsof -ti:PORT | xargs kill -9`** for specific port kills

## 📦 Installation

```bash
cd /srv/mcp
npm install
```

## 🚀 Quick Start

### Option 1: Start in tmux (Recommended)
```bash
cd /srv/mcp
./start-mcp.sh
```

### Option 2: Direct start (for testing)
```bash
cd /srv/mcp
npm start
```

### View Logs
```bash
# Attach to tmux session
tmux attach -t mcp-server

# Detach: Press Ctrl+B, then D
```

### Stop Server
```bash
tmux kill-session -t mcp-server
```

## 🔧 Available Tools

The MCP server provides these tools to Claude Android app:

### File Operations
- **`read_file`** - Read any file in `/srv` tree
- **`write_file`** - Write content to files in `/srv` tree
- **`list_directory`** - List directory contents

### Command Execution
- **`execute_command`** - Run bash commands safely (with forbidden command protection)

### Tmux Management
- **`tmux_list_sessions`** - List all tmux sessions with status
- **`tmux_session_status`** - Detailed status of a specific session
- **`tmux_capture_logs`** - Capture recent output from a session

### Service Management
- **`service_status`** - Check if service is running on a port
- **`restart_service_safe`** - Safely restart a service using tmux (NEVER uses killall)
- **`emergency_restart_all`** - Run `/srv/start-all-services.sh` (use sparingly)

### Context
- **`get_claude_context`** - Get CLAUDE.md for project context

## 🔒 Security Features

### Path Restrictions
- Only allows access to `/srv` directory tree
- All paths validated before file operations

### Command Safety
Forbidden commands automatically rejected:
- `killall`
- `pkill -9`
- `rm -rf /`
- `dd if=`
- `mkfs`
- `reboot`
- `shutdown`

### Resource Limits
- Max file size: 10MB
- Command timeout: 30 seconds
- Max output buffer: 5MB

## 📱 Android App Setup

### Prerequisites
1. SSH access to VM configured on Android device
2. Claude Android app installed
3. MCP server running on VM

### Connection Method: SSH + stdio

Since the Android app doesn't have direct network access to your VM, use **SSH tunneling with stdio transport**:

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

### Claude Android App Configuration

1. Open Claude Android app
2. Go to Settings → MCP Servers
3. Add new server with config above
4. Replace `YOUR_VM_IP` with your actual VM IP
5. Test connection

### Alternative: SSH Key Authentication (More Secure)

If you have SSH keys set up:

```json
{
  "mcpServers": {
    "srv-manager": {
      "command": "ssh",
      "args": [
        "-i", "/path/to/your/private/key",
        "root@YOUR_VM_IP",
        "cd /srv/mcp && node server.js"
      ],
      "transport": "stdio"
    }
  }
}
```

## 📊 Known Services

The server is aware of these tmux sessions (from CLAUDE.md):

| Session | Port | Description |
|---------|------|-------------|
| ps | 3399 | Stringborn Universe service |
| game-state | 3500 | Game state service |
| madladslab | 3000 | Main lab service |
| acm | - | ACM service |
| nocometalworkz | - | NoCoMetalWorkz service |
| sfg | - | SFG service |
| sna | - | SNA service |
| twww | - | TWWW service |
| w2portal | - | W2 Portal service |
| madThree | - | Mad Three service |

## 🧪 Testing

### Test file reading
```bash
# From Claude Android app, ask:
"Read the CLAUDE.md file for the ps project"
```

### Test tmux sessions
```bash
# From Claude Android app, ask:
"List all tmux sessions and their status"
```

### Test service status
```bash
# From Claude Android app, ask:
"Check if the ps service is running on port 3399"
```

### Test safe restart
```bash
# From Claude Android app, ask:
"Safely restart the ps service"
```

## 🐛 Troubleshooting

### Server won't start
```bash
# Check if dependencies are installed
cd /srv/mcp
npm install

# Check for port conflicts (if using HTTP transport)
lsof -ti:3100

# Check logs
tmux attach -t mcp-server
```

### Android app can't connect
- Verify SSH access works from Android device
- Test SSH connection manually first
- Check MCP server is running: `tmux ls | grep mcp-server`
- Verify config JSON syntax in Claude app

### Commands timing out
- Default timeout is 30 seconds
- Long-running commands may need higher timeout
- Check server logs: `tmux attach -t mcp-server`

## 📝 Example Usage from Android App

### Get project context
```
You: "Load the CLAUDE.md context for the ps project"
Claude: [Reads /srv/ps/docs/CLAUDE.md and provides summary]
```

### Check all services
```
You: "Check the status of all tmux sessions"
Claude: [Lists all sessions with running/stopped status]
```

### Capture logs
```
You: "Show me the last 50 lines of logs from the ps service"
Claude: [Captures logs from tmux session]
```

### Safe restart
```
You: "The ps service is stuck, please restart it safely"
Claude: [Uses restart_service_safe tool, never uses killall]
```

### Emergency restart
```
You: "Everything is broken, restart all services"
Claude: [Uses emergency_restart_all tool with /srv/start-all-services.sh]
```

## 🔄 Integration with start-all-services.sh

To automatically start MCP server with other services, add to `/srv/start-all-services.sh`:

```bash
# Start MCP server
echo "Starting MCP server..."
/srv/mcp/start-mcp.sh
```

## 📚 Related Documentation

- [/srv/ps/docs/CLAUDE.md](/srv/ps/docs/CLAUDE.md) - Main project context
- [/srv/start-all-services.sh](/srv/start-all-services.sh) - Service startup script

## 🤝 Contributing

When adding new tools:
1. Add to `ListToolsRequestSchema` handler
2. Add to `CallToolRequestSchema` handler
3. Follow safety rules (no destructive operations)
4. Update this README

## 📄 License

MIT
