# Huginn Webhook System — Setup Guide

This system allows your LLM at `ollama.madladslab.com` to send webhook events via SSH tunnel to this machine, which then displays them as animated floating modals on the Control Center displays.

## System Architecture

```
┌─────────────────────────────────────────────┐
│  ollama.madladslab.com (LLM)                │
│  - Huginn AI Model (deepseek-r1:7b)         │
│  - Event generation                         │
└──────────────────┬──────────────────────────┘
                   │ SSH Tunnel
                   │ (secure tunnel via SSH keys)
                   ▼
┌─────────────────────────────────────────────┐
│  This Machine (slab.madladslab.com)         │
│  ┌───────────────────────────────────────┐  │
│  │ POST /huginn/webhook                  │  │
│  │ - Receives webhook events             │  │
│  │ - Validates content                   │  │
│  │ - Emits Socket.IO events              │  │
│  └─────────────┬─────────────────────────┘  │
│                │                             │
│  ┌─────────────▼─────────────────────────┐  │
│  │ Socket.IO namespace: /huginn          │  │
│  │ - Room: 'control-center'              │  │
│  │ - Event: 'deploy'                     │  │
│  └─────────────┬─────────────────────────┘  │
└────────────────┼─────────────────────────────┘
                 │ WebSocket
                 ▼
┌─────────────────────────────────────────────┐
│  Control Center Displays                    │
│  URL: /superadmin/control-center            │
│  - Three.js Huginn orb visualization        │
│  - Animated floating modals                 │
│  - Typewriter text reveal                   │
└─────────────────────────────────────────────┘
```

## Endpoints

### 1. Webhook Endpoint
**URL:** `POST http://slab.madladslab.com:3602/huginn/webhook`

**Request Body:**
```json
{
  "content": "Your message content here (supports markdown)",
  "type": "alert",  // Optional: "text", "code", "alert", "metric"
  "displayId": "all",  // Optional: target specific display or "all"
  "secret": "your-secret-key"  // Optional: if HUGINN_WEBHOOK_SECRET is set
}
```

**Response:**
```json
{
  "ok": true,
  "deploymentId": "unique-id-here",
  "message": "Event deployed to control center"
}
```

### 2. Health Check
**URL:** `GET http://slab.madladslab.com:3602/huginn/health`

**Response:**
```json
{
  "ok": true,
  "displays": 2,  // Number of connected control center displays
  "operators": 1,  // Number of Huginn chat operators
  "timestamp": "2026-04-05T22:16:25.226Z"
}
```

## Message Types

### `type: "text"` (default)
Standard text message with markdown support. Displayed as a card with green accent.

**Example:**
```json
{
  "content": "Standard text message with **bold** and *italic* support",
  "type": "text"
}
```

### `type: "alert"`
High-priority alert message with purple glow and animation. Best for important notifications.

**Example:**
```json
{
  "content": "**Critical Alert:** System threshold exceeded!\n\nImmediate attention required.",
  "type": "alert"
}
```

### `type: "code"`
Code snippets and technical information. Displayed with monospace font.

**Example:**
```json
{
  "content": "```python\ndef analyze_data(input):\n    return process(input)\n```",
  "type": "code"
}
```

## SSH Tunnel Setup

To forward webhooks from `ollama.madladslab.com` to this machine:

### On ollama.madladslab.com:

```bash
# Create reverse SSH tunnel from ollama to slab
ssh -R 9999:localhost:3602 root@slab.madladslab.com -N -f

# Or use autossh for persistent tunnel
autossh -M 0 -R 9999:localhost:3602 root@slab.madladslab.com -N -f
```

This creates a tunnel where:
- `localhost:9999` on `ollama.madladslab.com` → forwards to `localhost:3602` on `slab.madladslab.com`

### From ollama.madladslab.com, send webhooks to:
```bash
curl -X POST http://localhost:9999/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Message from Huginn LLM",
    "type": "alert"
  }'
```

## Environment Variables

Add to `/srv/slab/.env`:

```bash
# Optional: Webhook secret for security
HUGINN_WEBHOOK_SECRET=your-random-secret-key-here
```

If set, all webhook requests must include the `secret` field:
```json
{
  "content": "Your message",
  "secret": "your-random-secret-key-here"
}
```

## Testing

### 1. Check if server is running:
```bash
curl http://localhost:3602/huginn/health
```

### 2. Test a simple webhook:
```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Test message from Huginn",
    "type": "alert"
  }'
```

### 3. Open Control Center:
Navigate to: `https://slab.madladslab.com/superadmin/control-center`

You should see:
- The Three.js Huginn orb visualization
- Your test message appearing as an animated floating modal
- Typewriter effect revealing the text

## Display Features

The Control Center displays include:

1. **Three.js Huginn Orb**
   - Purple/gold animated orb
   - Lightning effects
   - Particle systems
   - Rune ring rotation
   - Intensity increases when operator is online

2. **Animated Cards**
   - Slide-in animation
   - Typewriter text reveal for long messages
   - Color-coded by type (text=green, code=blue, alert=purple)
   - Timestamp and sender info

3. **Operator Status**
   - Shows when Huginn chat operator is connected
   - Displays connected displays count
   - Real-time connection status

## Usage Examples

### Example 1: System Status Update
```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "**System Status:** All services operational\n\n- API: ✓ Online\n- Database: ✓ Connected\n- Cache: ✓ Active",
    "type": "text"
  }'
```

### Example 2: Code Deployment
```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "```javascript\nconst result = await processData();\nconsole.log(result);\n```",
    "type": "code"
  }'
```

### Example 3: Critical Alert
```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "🔴 **CRITICAL ALERT**\n\nDatabase connection lost!\n\nAttempting reconnection...",
    "type": "alert"
  }'
```

### Example 4: Target Specific Display
```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "content": "This message goes to a specific display only",
    "type": "text",
    "displayId": "display-abc123"
  }'
```

## Troubleshooting

### Webhook returns 503 error
- Server is starting up, wait a few seconds
- Socket.IO not initialized yet

### Webhook returns 401 error
- `HUGINN_WEBHOOK_SECRET` is set but wrong secret provided
- Add correct secret to request body

### Message doesn't appear on Control Center
- Check that Control Center is open in browser
- Verify Socket.IO connection (look for "connected" status in topbar)
- Check browser console for errors
- Verify webhook returned `ok: true`

### SSH Tunnel Issues
- Verify SSH keys are properly configured
- Check tunnel is active: `ps aux | grep ssh`
- Test local connectivity: `curl http://localhost:9999/huginn/health`
- Check firewall rules on both machines

## File Locations

- Webhook Router: `/srv/slab/routes/huginn-webhook.js`
- Socket.IO Config: `/srv/slab/plugins/socketio.js`
- Control Center View: `/srv/slab/views/superadmin/control-center.ejs`
- Huginn Chat View: `/srv/slab/views/superadmin/huginn.ejs`
- Main App: `/srv/slab/app.js`

## Next Steps

1. **Set up persistent SSH tunnel** from ollama.madladslab.com
2. **Configure autossh** for automatic reconnection
3. **Add HUGINN_WEBHOOK_SECRET** to .env for security
4. **Create LLM integration** to automatically send events
5. **Open Control Center** on display monitors for visualization

---

**Status:** ✅ Webhook system is live and operational!

**Test it now:**
```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{"content":"🚀 Huginn Webhook System is LIVE!","type":"alert"}'
```
