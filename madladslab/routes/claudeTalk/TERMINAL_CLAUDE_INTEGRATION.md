# Claude AI Terminal Integration

## Overview
The claudeTalk terminal now includes a **dual-mode interface** that allows you to switch between:
1. **Shell Command Mode** - Execute traditional shell commands
2. **Claude AI Mode** - Chat with Claude AI with full system access

## Features

### Shell Command Mode
- Execute shell commands directly on the server
- Change working directory
- Command history with arrow keys (↑/↓)
- Quick command buttons for common tasks
- Real-time output display

### Claude AI Mode
- **Ultra-concise CLI-style responses** - Optimized for terminal use
- Natural language interaction with Claude
- Claude has access to system tools:
  - Execute commands
  - Read/write files
  - Manage services (tmux sessions)
  - Check server status
  - List directories
- **Smart response formatting**:
  - Automatic truncation to <100 characters
  - Tool-aware summaries (e.g., "✓ 11 services running")
  - Minimal token usage (uses Haiku model + 150 token limit)
- Visual display of tool executions (compact format)
- Conversation history maintained per session

## How to Use

### Accessing the Terminal
Navigate to: `http://104.237.138.28/claudeTalk/terminal`

### Switching Modes
Click the mode toggle buttons at the top:
- **Shell Commands** - Traditional terminal mode
- **Claude AI** - AI assistant mode

### Claude AI Mode Examples

**Ask about system status:**
```
User: check server status
Claude: ✓ CPU 2.4% • RAM 2.7Gi/7.7Gi • Disk 12G/157G (8%)
```

**List services:**
```
User: what services
Claude: ✓ 10 services running
```

**File operations:**
```
User: read package.json
Claude: ✓ File read (1234 bytes)
```

**Execute commands:**
```
User: run git status
Claude: ✓ On branch main nothing to commit, working tree clean
```

**Response Format:**
- ✓ = Success
- ❌ = Failure
- All responses <100 characters
- Tool details shown separately below response

## Technical Details

### API Endpoints Used
- `POST /claudeTalk/message` - Send messages to Claude AI
- `POST /claudeTalk/executeCommand` - Execute shell commands

### Session Management
- Each terminal session gets a unique Claude conversation ID
- Conversation history is maintained for context
- Maximum 40 messages kept in history to prevent context overflow

### Tool Access
Claude has access to the following tools through the vmTools.js module:
- `execute_command` - Run shell commands
- `read_file` - Read file contents
- `write_file` - Create/update files
- `list_directory` - Browse directories
- `list_services` - Show running tmux sessions
- `restart_service` - Restart services
- `get_service_logs` - View service logs
- `check_server_status` - Get CPU, memory, disk stats

## UI Features

### Visual Indicators
- **Shell Mode**: Green terminal prompt `$`
- **Claude Mode**: Blue brain icon 🧠
- **Tool Executions**: Green highlighted boxes showing what Claude did
- **Errors**: Red text for error messages
- **Success**: Green text for successful operations

### Keyboard Shortcuts
- `Enter` - Execute command/send message
- `↑` - Previous command in history
- `↓` - Next command in history

### Quick Actions
- **History** - View and reuse previous commands
- **Clear** - Clear terminal output
- **Browser** - Open file browser
- **Sessions** - Manage tmux sessions
- **Chat** - Open full chat interface

## Configuration

### Environment Variables
Requires `ANTHROPIC_API_KEY` in `/srv/madladslab/.env`

### Model Used
- **Terminal Mode**: `claude-3-5-haiku-20241022` (faster, cheaper, concise)
- **Chat Mode**: `claude-sonnet-4-20250514` (more detailed)
- Configurable in the `/claudeTalk/message` endpoint

### Token Optimization
Terminal mode is highly optimized for minimal token usage:
- **Max tokens**: 150 (vs 4096 in chat mode)
- **Temperature**: 0 (deterministic responses)
- **Response truncation**: Automatic <100 char limit
- **Smart summarization**: Extracts key info from tool results
- **Average cost**: ~90% less than chat mode

Examples of optimization:
```
Before: "There are currently 11 services running on the server: 1. acm... [300+ words]"
After:  "✓ 11 services running"

Before: "Here's the current server status: CPU Usage: 2.3%... [200+ words]"
After:  "✓ CPU 2.4% • RAM 2.7Gi/7.7Gi • Disk 12G/157G (8%)"
```

## Security Notes
- Claude has full system access through the vmTools
- Commands are executed with server permissions
- File operations create automatic backups
- Conversation history is stored in server memory (not persisted)

## Example Workflow

1. Open terminal at `/claudeTalk/terminal`
2. Click "Claude AI" mode button
3. Type: "What services are currently running?"
4. Claude will execute `list_services` tool and respond
5. Ask follow-up: "Show me the logs for madladslab"
6. Claude will execute `get_service_logs` and display results
7. Switch to "Shell Commands" mode for direct terminal access

## Troubleshooting

### Claude not responding
- Check that ANTHROPIC_API_KEY is set in .env
- Verify madladslab service is running: `tmux ls`
- Check logs: `tmux capture-pane -t madladslab -p`

### Commands not executing in Claude mode
- Ensure you're asking Claude to do something (not just typing commands)
- Example: "Please run ls -la" instead of just "ls -la"

### Tool executions not showing
- Tool results are displayed below Claude's response
- Look for green-highlighted boxes with tool names

## Created
November 8, 2025

## Last Updated
November 8, 2025
