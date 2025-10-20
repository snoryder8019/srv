# ClaudeTalk VM Control - Complete Guide

## Overview

ClaudeTalk now has **full VM control capabilities**! You can manage your server, services, files, and execute commands directly through natural language conversation.

## What You Can Do

### 🔧 System Control
- Start/stop/restart services (madladslab, ps, sfg, etc.)
- Check service logs
- View server status (CPU, memory, disk)
- List all running services

### 📁 File Management
- Read any file on the server
- Write/update files (with automatic backups)
- List directories
- Navigate the file system

### 💻 Command Execution
- Run any shell command
- Get stdout/stderr output
- Execute scripts
- Install packages

## Available Tools

### 1. `execute_command`
Execute any shell command on the server.

**Example requests:**
- "Check if port 3000 is listening"
- "Show me disk usage"
- "Install the lodash package"

### 2. `list_services`
List all running tmux sessions (services).

**Example requests:**
- "What services are running?"
- "Show me all active sessions"

### 3. `restart_service`
Restart a specific service.

**Example requests:**
- "Restart the madladslab service"
- "Restart ps"

### 4. `get_service_logs`
Get console output from a service.

**Example requests:**
- "Show me the logs for madladslab"
- "What's happening in the ps service?"
- "Show me the last 100 lines from sfg"

### 5. `read_file`
Read contents of any file.

**Example requests:**
- "Show me the package.json"
- "Read /srv/madladslab/routes/index.js"
- "What's in the .env file?"

### 6. `write_file`
Write or update files (creates backups automatically).

**Example requests:**
- "Create a new file called test.js with console.log('hello')"
- "Update the README.md to add a new section"

### 7. `list_directory`
List files in a directory.

**Example requests:**
- "What files are in /srv?"
- "Show me the madladslab directory"
- "List all files in the routes folder"

### 8. `check_server_status`
Get overall server health.

**Example requests:**
- "How's the server doing?"
- "Check system status"
- "Show me CPU and memory usage"

## Example Conversations

### Example 1: Check Server Status
```
You: How is the server doing?

Claude: I'll check the server status for you.
🔧 Tool: check_server_status
Result: {
  "cpu": "5.2%",
  "memory": "2.1G / 4.0G",
  "disk": "15G / 50G (32%)",
  "services": ["madladslab_session", "ps_session", "sfg_session"]
}

The server looks healthy! CPU usage is at 5.2%, you're using 2.1GB out of 4GB memory,
and disk is at 32% capacity. I see 3 services running.
```

### Example 2: Restart a Service
```
You: The madladslab service seems slow, can you restart it?

Claude: I'll restart the madladslab service for you.
🔧 Tool: restart_service
Input: {"service": "madladslab"}
Result: {"success": true, "message": "Service madladslab restarted successfully"}

Done! The madladslab service has been restarted and should be running normally now.
```

### Example 3: Check Logs
```
You: Show me what's happening in the ps service

Claude: Let me get the logs from the ps service.
🔧 Tool: get_service_logs
Input: {"service": "ps", "lines": 50}
Result: {
  "success": true,
  "logs": "[nodemon] starting `node ./bin/www`\nServer listening on port 3001..."
}

The ps service is running normally. It started with nodemon and is listening on port 3001.
```

### Example 4: File Operations
```
You: Read the package.json file and tell me what version of express we're using

Claude: I'll read the package.json file.
🔧 Tool: read_file
Input: {"path": "madladslab/package.json"}
Result: {
  "success": true,
  "content": "{\"dependencies\": {\"express\": \"^4.21.1\", ...}}"
}

You're using Express version ^4.21.1 (which means 4.21.1 or higher).
```

### Example 5: Complex Task
```
You: Create a new route file called test.js in /srv/madladslab/routes/ with a basic Express router

Claude: I'll create that file for you.
🔧 Tool: write_file
Input: {
  "path": "/srv/madladslab/routes/test.js",
  "content": "import express from 'express';\nconst router = express.Router();\n\nrouter.get('/', (req, res) => {\n  res.json({ message: 'Test route' });\n});\n\nexport default router;"
}
Result: {"success": true, "message": "File written successfully"}

Done! I've created /srv/madladslab/routes/test.js with a basic Express router.
The file includes a GET route at / that returns a JSON message.
```

## Safety Features

### Automatic Backups
- Files are backed up before writing (saved as `filename.backup`)
- Rollback possible if something goes wrong

### Command Timeouts
- Commands timeout after 30 seconds by default
- Prevents hanging processes

### Error Handling
- All tool executions have try-catch
- Errors are returned with details
- Stack traces for debugging

### Session Isolation
- Each chat session maintains its own conversation
- Tool results stay within the session

## Security Notes

⚠️ **Important Security Considerations:**

1. **Full System Access**: Claude has the same permissions as the Node.js process (root in this case)
2. **No Sudo Prompt**: Commands execute immediately without confirmation
3. **File System Access**: Can read/write any file the process can access
4. **Command Execution**: Can run any shell command

**Recommendations:**
- Use for trusted users only
- Consider adding command whitelisting
- Log all tool executions
- Add rate limiting
- Consider running Node as non-root user

## How It Works

### Tool Use Loop
```
1. You send a message
2. Claude analyzes if it needs tools
3. If yes:
   a. Claude requests tool execution
   b. Server executes tool
   c. Result sent back to Claude
   d. Claude formulates response
4. Response displayed with tool results
```

### Architecture
```
Frontend (Chat UI)
    ↓
POST /claudeTalk/message
    ↓
Claude API (with tools)
    ↓
Tool Execution (vmTools.js)
    ↓
System Commands / File Operations
    ↓
Results → Claude → Frontend
```

## Testing Examples

Try these commands in the chat:

### Basic Tests
```
1. "List all running services"
2. "Check server status"
3. "Show me what's in the /srv directory"
4. "Read the auto-start-npm.json file"
```

### Service Management
```
1. "What services are currently running?"
2. "Show me the logs for madladslab"
3. "Restart the ps service"
```

### File Operations
```
1. "Create a file called hello.txt with 'Hello World'"
2. "Read the hello.txt file"
3. "List files in the current directory"
```

### System Commands
```
1. "Check disk usage"
2. "Show me network connections on port 3000"
3. "What's the current system uptime?"
```

## Troubleshooting

### "Tool execution failed"
- Check server logs: `tmux attach -t madladslab_session`
- Verify file permissions
- Check command syntax

### Service restart not working
- Service name might be wrong
- Check if service exists: `tmux list-sessions`
- Verify package.json exists in service directory

### File operations failing
- Check absolute path vs relative path
- Verify file permissions
- Check disk space

## Future Enhancements

Potential additions:
- [ ] Git operations (commit, push, pull)
- [ ] Database queries
- [ ] Docker container management
- [ ] Log analysis tools
- [ ] Automated backups
- [ ] Performance monitoring
- [ ] Security scanning
- [ ] Deployment tools

## Files Modified

1. `/srv/madladslab/lib/vmTools.js` - Tool definitions and handlers
2. `/srv/madladslab/routes/claudeTalk/index.js` - Tool integration
3. `/srv/madladslab/views/claudeTalk/index.ejs` - UI for tool results

## API Reference

### POST /claudeTalk/message
```javascript
Request:
{
  "message": "Check server status",
  "sessionId": "default",
  "model": "claude-sonnet-4-20250514"
}

Response:
{
  "success": true,
  "response": "The server is running well...",
  "toolsUsed": [
    {
      "tool": "check_server_status",
      "input": {},
      "result": { "cpu": "5%", ... }
    }
  ],
  "usage": { "input_tokens": 123, "output_tokens": 456 }
}
```

---

**Your ClaudeTalk chat is now a powerful VM control interface!** 🚀

Try it out: `http://104.237.138.28/claudeTalk`
