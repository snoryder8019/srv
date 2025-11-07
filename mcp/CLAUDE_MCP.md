# Claude MCP Context - /srv VM Management

**Last Updated:** November 6, 2025
**Purpose:** MCP server for Claude Android app to manage /srv VM safely

---

## 🎯 What This Is

An MCP (Model Context Protocol) server that allows your Claude Android app to:
- Execute commands on the VM safely
- Read and write files in `/srv`
- Manage tmux sessions without crashing services
- Monitor service status on various ports
- Restart services safely (NEVER using killall)

## 🚨 Safety First

This MCP server implements ALL safety rules from `/srv/ps/docs/CLAUDE.md`:

### Forbidden Forever
- ❌ `killall node` - Kills ALL services!
- ❌ `pkill -9` without specific targets
- ❌ `rm -rf /` or similar destructive commands
- ❌ Direct process kills without tmux awareness

### Always Do This Instead
- ✅ `tmux kill-session -t SESSION_NAME` - Stop specific service
- ✅ `lsof -ti:PORT | xargs kill -9` - Kill by port
- ✅ `/srv/start-all-services.sh` - Emergency restart all
- ✅ Restart specific services via tmux management

## 🛠️ Available Tools

### File Management
1. **read_file** - Read any file in `/srv`
2. **write_file** - Write content to files
3. **list_directory** - Browse directories

### Tmux Management (Critical!)
4. **tmux_list_sessions** - See all sessions and their status
5. **tmux_session_status** - Detailed status for one session
6. **tmux_capture_logs** - Get recent output from a session

### Service Control
7. **service_status** - Check if port is listening
8. **restart_service_safe** - Restart via tmux (safe!)
9. **emergency_restart_all** - Run start-all-services.sh

### Command Execution
10. **execute_command** - Run bash commands with safety checks
11. **get_claude_context** - Load CLAUDE.md for project context

## 📱 Android App Configuration

Add this to Claude Android MCP settings:

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

Replace `YOUR_VM_IP` with your actual VM IP address.

## 🔧 Installation

```bash
cd /srv/mcp
npm install
./start-mcp.sh
```

## 🎮 Usage Examples

### From Claude Android App

**Check all services:**
```
You: "List all tmux sessions and show which are running"
```

**Read project context:**
```
You: "Load the CLAUDE.md file so you know the current state"
```

**Restart a service safely:**
```
You: "The ps service on port 3399 needs to be restarted"
```

**View service logs:**
```
You: "Show me the last 100 lines from the madladslab session"
```

**Emergency full restart:**
```
You: "Run the start-all-services.sh script"
```

## 📊 Known Services

| Session | Port | Description | Directory |
|---------|------|-------------|-----------|
| ps | 3399 | Stringborn Universe | /srv/ps |
| game-state | 3500 | Game state | - |
| madladslab | 3000 | Main lab | /srv/madladslab |
| acm | - | ACM service | /srv/acm |
| nocometalworkz | - | Music site | /srv/nocometalworkz |

## 🔒 Security

### Path Restrictions
- Only `/srv` directory accessible
- All paths validated before operations

### Command Protection
Automatic rejection of:
- killall, pkill -9
- rm -rf /
- dd, mkfs
- reboot, shutdown

### Resource Limits
- 10MB max file size
- 30 second command timeout
- 5MB max output buffer

## 🐛 Common Issues

### "Connection failed"
- Check MCP server running: `tmux ls | grep mcp-server`
- Verify SSH access from Android device
- Test: `ssh root@YOUR_VM_IP "cd /srv/mcp && node server.js"`

### "Command timed out"
- Default 30s timeout may be too short
- Long commands need explicit timeout parameter
- Check server logs: `tmux attach -t mcp-server`

### "Access denied"
- File must be in `/srv` directory tree
- Check file path is absolute (starts with `/srv`)

## 🎯 Next Steps

1. **Install dependencies:** `cd /srv/mcp && npm install`
2. **Start server:** `./start-mcp.sh`
3. **Configure Android app** with SSH connection details
4. **Test connection** by asking Claude to list tmux sessions
5. **Load context** by asking Claude to read CLAUDE.md

## 📚 Related Files

- `/srv/mcp/README.md` - Full documentation
- `/srv/mcp/server.js` - MCP server implementation
- `/srv/ps/docs/CLAUDE.md` - Main project context
- `/srv/start-all-services.sh` - Emergency restart script

---

*This MCP server respects all safety rules and will NEVER use `killall node`*
