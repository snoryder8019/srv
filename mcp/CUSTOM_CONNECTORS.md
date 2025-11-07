# Claude Custom Connectors - HTTPS Setup

## ✅ Live HTTPS API

Your MCP API is now available via HTTPS at:
```
https://madladslab.com/api/v1/mcp/
```

## 📱 Setup Custom Connectors (Mobile Browser)

### Step 1: Open Claude in Browser
1. On your phone, open your browser (Chrome, Safari, etc.)
2. Go to **https://claude.ai**
3. Log in to your account

### Step 2: Add Custom Connectors
1. Click **Settings** ⚙️
2. Look for **"Integrations"** or **"Custom Connectors"**
3. Click **"Add Custom Connector"**

### Step 3: Configure These Connectors

#### 🔍 Connector 1: Check All Services
- **Name:** Check Services
- **URL:** `https://madladslab.com/api/v1/mcp/tmux/sessions`
- **Method:** GET
- **Description:** List all tmux service statuses

#### 🎯 Connector 2: PS Service Status
- **Name:** PS Status
- **URL:** `https://madladslab.com/api/v1/mcp/service/port/3399`
- **Method:** GET
- **Description:** Check if Stringborn Universe is running

#### 📋 Connector 3: PS Logs
- **Name:** PS Logs
- **URL:** `https://madladslab.com/api/v1/mcp/tmux/logs/ps?lines=50`
- **Method:** GET
- **Description:** View recent PS service logs

#### 📖 Connector 4: Get Context
- **Name:** PS Context
- **URL:** `https://madladslab.com/api/v1/mcp/context/ps`
- **Method:** GET
- **Description:** Read CLAUDE.md for PS project

#### 🏥 Connector 5: Health Check
- **Name:** MCP Health
- **URL:** `https://madladslab.com/api/v1/mcp/health`
- **Method:** GET
- **Description:** Check if API is responding

### Step 4: Test It!

Ask Claude:
```
"Use the Check Services connector to show me what's running"
"Check the PS Status - is port 3399 listening?"
"Get me the PS Logs from the last 50 lines"
"Read the PS Context file"
```

## 🔥 All Available Endpoints

### GET Endpoints (Simple - Use These First!)

| Endpoint | URL | Description |
|----------|-----|-------------|
| Health Check | `https://madladslab.com/api/v1/mcp/health` | API status |
| List Sessions | `https://madladslab.com/api/v1/mcp/tmux/sessions` | All tmux sessions |
| Session Status | `https://madladslab.com/api/v1/mcp/tmux/session/{name}` | Specific session |
| Session Logs | `https://madladslab.com/api/v1/mcp/tmux/logs/{name}?lines=100` | Capture logs |
| Port Status | `https://madladslab.com/api/v1/mcp/service/port/{port}` | Check if port listening |
| Get Context | `https://madladslab.com/api/v1/mcp/context/{project}` | Read CLAUDE.md |

### POST Endpoints (Advanced)

These require JSON body, so you'll need to configure them with request body in Custom Connectors:

**Read File:**
```
POST https://madladslab.com/api/v1/mcp/read-file
Content-Type: application/json

{
  "path": "/srv/ps/package.json"
}
```

**List Directory:**
```
POST https://madladslab.com/api/v1/mcp/list-directory
Content-Type: application/json

{
  "path": "/srv/ps/docs"
}
```

**Execute Command:**
```
POST https://madladslab.com/api/v1/mcp/execute
Content-Type: application/json

{
  "command": "ps aux | grep node",
  "timeout": 30000
}
```

## 🎯 Example Usage

### Check What's Running
```
Ask: "Use Check Services to see what's active"
Response: Shows PS and madladslab are running
```

### Debug PS Service
```
Ask: "Check PS Status and show me the logs"
Response: Port 3399 is listening, here are recent logs...
```

### Read Documentation
```
Ask: "Get the PS Context so you understand the project"
Response: Loads /srv/ps/docs/CLAUDE.md content
```

## 🔐 Security Features

✅ **HTTPS Only** - All traffic encrypted
✅ **Path Restrictions** - Only `/srv` directory accessible
✅ **Command Filtering** - Blocks dangerous operations
✅ **File Size Limits** - Max 10MB per file
✅ **Timeouts** - Commands timeout after 30s

❌ **Blocks:**
- `killall` - Would kill all services
- `rm -rf /` - Destructive commands
- `reboot` / `shutdown` - System commands
- Access outside `/srv` directory

## 📊 Quick Reference

### Most Useful Connectors (Start Here!)

1. **https://madladslab.com/api/v1/mcp/tmux/sessions**
   → See what services are running

2. **https://madladslab.com/api/v1/mcp/service/port/3399**
   → Is PS service up?

3. **https://madladslab.com/api/v1/mcp/tmux/logs/ps?lines=50**
   → Recent PS logs

4. **https://madladslab.com/api/v1/mcp/context/ps**
   → Project documentation

### Test URLs Right Now

Open these in your phone browser to verify they work:

✅ **Health:** https://madladslab.com/api/v1/mcp/health
✅ **Services:** https://madladslab.com/api/v1/mcp/tmux/sessions
✅ **PS Status:** https://madladslab.com/api/v1/mcp/service/port/3399

## 🎓 Pro Tips

1. **Start with GET endpoints** - They're easier to configure
2. **Test in browser first** - Make sure URLs work before adding to Claude
3. **Use query parameters** - Add `?lines=50` to logs endpoint
4. **Name connectors clearly** - "PS Status" better than "Connector 1"
5. **Save frequently used ones** - Make connectors for common checks

## 🐛 Troubleshooting

### "Connection failed"
- Check: https://madladslab.com/api/v1/mcp/health in browser
- If that works, issue is with Custom Connector config
- If that fails, madladslab service may be down

### "SSL/Certificate error"
- SSL cert is valid from Let's Encrypt
- Try accessing in regular browser first
- May need to trust certificate on mobile device

### "Access denied" or 403 error
- Path must be within `/srv` directory
- Check that you're using correct JSON format for POST

### Service is down
```bash
# SSH to server
ssh root@104.237.138.28

# Restart madladslab
tmux kill-session -t madladslab
tmux new-session -d -s madladslab -c /srv/madladslab "PORT=3000 npm start"

# Check it started
tmux ls | grep madladslab
```

## 🔧 Technical Details

### Architecture
```
Claude Browser (HTTPS)
    ↓
madladslab.com (Apache + SSL)
    ↓
Node.js App :3000 (Express)
    ↓
/api/v1/mcp routes
    ↓
Server operations (tmux, files, commands)
```

### Files
- API Code: `/srv/madladslab/api/v1/mcp/index.js`
- Apache Config: `/etc/apache2/sites-available/madladslab-graffitiTV-ssl.conf`
- SSL Cert: `/etc/letsencrypt/live/madladslab.com/`

### Service Management
```bash
# View madladslab logs
tmux attach -t madladslab

# Restart madladslab
tmux kill-session -t madladslab && \
tmux new-session -d -s madladslab -c /srv/madladslab "PORT=3000 npm start"

# Check Apache
sudo systemctl status apache2

# Reload Apache (if config changes)
sudo apache2ctl graceful
```

## 📞 Need Help?

**Test the API directly:**
```bash
curl https://madladslab.com/api/v1/mcp/health
curl https://madladslab.com/api/v1/mcp/tmux/sessions
```

**Check service status:**
```bash
tmux ls
lsof -ti:3000  # madladslab
lsof -ti:3399  # ps
```

---

## ✅ Setup Complete!

You now have a secure HTTPS API for managing your server through Claude Custom Connectors!

**Next:** Open https://claude.ai in your phone browser and add the connectors above.
