# Agent Integration with MCP (Model Context Protocol)

## Overview

This guide explains how AI agents in the madLadsLab platform can integrate with MCP endpoints to access system resources, files, and execute commands.

## Available MCP Tools for Agents

### 1. **read-file**
- **Endpoint:** `POST /api/v1/mcp/read-file`
- **Description:** Read file contents from `/srv` directory
- **Required Headers:** `x-mcp-secret`
- **Request Body:**
  ```json
  {
    "path": "/srv/madladslab/routes/agents/index.js"
  }
  ```
- **Use Cases:**
  - Reading configuration files
  - Accessing code for analysis
  - Loading context documents

### 2. **list-directory**
- **Endpoint:** `POST /api/v1/mcp/list-directory`
- **Description:** List directory contents
- **Required Headers:** `x-mcp-secret`
- **Request Body:**
  ```json
  {
    "path": "/srv/madladslab/routes"
  }
  ```
- **Use Cases:**
  - Exploring project structure
  - Finding specific files
  - Directory navigation

### 3. **execute**
- **Endpoint:** `POST /api/v1/mcp/execute`
- **Description:** Execute shell commands (with restrictions)
- **Required Headers:** `x-mcp-secret`
- **Request Body:**
  ```json
  {
    "command": "npm list",
    "cwd": "/srv/madladslab"
  }
  ```
- **Forbidden Commands:** `rm -rf`, `dd`, `mkfs`, `format`, `del /f`, destructive operations
- **Use Cases:**
  - Running build scripts
  - Checking service status
  - Installing dependencies

### 4. **tmux-sessions**
- **Endpoint:** `GET /api/v1/mcp/tmux/sessions`
- **Description:** List all tmux sessions
- **Required Headers:** `x-mcp-secret`
- **Use Cases:**
  - Monitoring active sessions
  - Session management

### 5. **tmux-logs**
- **Endpoint:** `GET /api/v1/mcp/tmux/logs/:sessionName?lines=100`
- **Description:** View tmux session logs
- **Required Headers:** `x-mcp-secret`
- **Query Parameters:** `lines` (default: 100)
- **Use Cases:**
  - Debugging sessions
  - Monitoring application logs

### 6. **service-port**
- **Endpoint:** `GET /api/v1/mcp/service/port/:port`
- **Description:** Check process running on specific port
- **Required Headers:** `x-mcp-secret`
- **Use Cases:**
  - Service availability checks
  - Port conflict detection

### 7. **context**
- **Endpoint:** `GET /api/v1/mcp/context/:project`
- **Description:** Get project context files (CLAUDE.md)
- **Required Headers:** `x-mcp-secret`
- **Use Cases:**
  - Loading project documentation
  - Understanding codebase context

## Authentication

All MCP endpoints require authentication via the `x-mcp-secret` header:

```javascript
headers: {
  'x-mcp-secret': process.env.MCP_SECRET
}
```

The MCP secret key is stored in:
- Environment variable: `process.env.MCP_SECRET`
- Secret file: `/root/.ssh/mcp_0001`

## Agent Configuration

### Enabling MCP Tools for an Agent

1. **Via Dashboard:** Navigate to agent → Tuning tab → MCP Tools section
2. **Via API:**
   ```javascript
   POST /agents/api/agents/:id/mcp/enable
   {
     "tools": ["read-file", "list-directory", "execute"]
   }
   ```

### Checking Agent's MCP Configuration

```javascript
GET /agents/api/agents/:id/mcp
```

Response:
```json
{
  "success": true,
  "mcpConfig": {
    "enabledTools": ["read-file", "list-directory"],
    "endpoints": []
  }
}
```

## Integration Examples

### Example 1: Reading a Configuration File

```javascript
// Agent reads environment configuration
const response = await fetch('http://localhost:3000/api/v1/mcp/read-file', {
  method: 'POST',
  headers: {
    'x-mcp-secret': process.env.MCP_SECRET,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    path: '/srv/madladslab/.env'
  })
});

const data = await response.json();
console.log(data.content);
```

### Example 2: Listing Project Routes

```javascript
// Agent explores available routes
const response = await fetch('http://localhost:3000/api/v1/mcp/list-directory', {
  method: 'POST',
  headers: {
    'x-mcp-secret': process.env.MCP_SECRET,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    path: '/srv/madladslab/routes'
  })
});

const data = await response.json();
data.files.forEach(file => console.log(file.name));
```

### Example 3: Executing a Safe Command

```javascript
// Agent checks npm dependencies
const response = await fetch('http://localhost:3000/api/v1/mcp/execute', {
  method: 'POST',
  headers: {
    'x-mcp-secret': process.env.MCP_SECRET,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    command: 'npm list mongoose',
    cwd: '/srv/madladslab'
  })
});

const data = await response.json();
console.log(data.output);
```

## Security Considerations

1. **Path Restrictions:**
   - `read-file` and `list-directory` are restricted to `/srv` directory
   - Attempts to access other paths will be rejected

2. **Command Filtering:**
   - Destructive commands are blocked
   - See `/srv/madladslab/api/v1/mcp/index.js` for full forbidden list

3. **Authentication:**
   - All requests must include valid `x-mcp-secret` header
   - Secret rotation should be performed regularly

4. **Rate Limiting:**
   - Consider implementing rate limits for agent MCP calls
   - Monitor agent activity for unusual patterns

## Best Practices

1. **Enable Only Required Tools:**
   - Only enable MCP tools that an agent actually needs
   - Minimize attack surface

2. **Validate Responses:**
   - Always check response status and error messages
   - Handle errors gracefully

3. **Log MCP Usage:**
   - Agent logs should record all MCP tool usage
   - Helps with debugging and security auditing

4. **Context Awareness:**
   - Use `context` endpoint to load project documentation
   - Helps agents understand codebase before executing commands

## Troubleshooting

### Common Errors

**Error: "Invalid MCP secret"**
- Check `process.env.MCP_SECRET` is set correctly
- Verify secret matches `/root/.ssh/mcp_0001`

**Error: "Path not allowed"**
- Ensure path is within `/srv` directory
- Check for typos in path

**Error: "Forbidden command"**
- Command is blacklisted for security
- Try alternative approach

## Service Registry

The service registry is maintained in `/srv/.claude-context.json` and contains:
- Service names and descriptions
- Port assignments
- tmux session names
- File locations

Access via: `GET /api/v1/mcp/context/:project`

## Further Reading

- Main MCP Documentation: `/srv/madladslab/api/v1/mcp/CLAUDE.md`
- API Implementation: `/srv/madladslab/api/v1/mcp/index.js`
- Agent Routes: `/srv/madladslab/routes/agents/index.js`

---

**Last Updated:** March 2026
**Maintained by:** madLadsLab Development Team
