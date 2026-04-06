# Huginn Webhook — Quick Reference

## URLs

- **Webhook Endpoint:** `http://localhost:3602/huginn/webhook`
- **Health Check:** `http://localhost:3602/huginn/health`
- **Control Center:** `https://slab.madladslab.com/superadmin/control-center`
- **Huginn Chat:** `https://slab.madladslab.com/superadmin/huginn`

## Quick Test

```bash
curl -X POST http://localhost:3602/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{"content":"Test message","type":"alert"}'
```

## SSH Tunnel (from ollama.madladslab.com)

```bash
# Create reverse tunnel
ssh -R 9999:localhost:3602 root@slab.madladslab.com -N -f

# Then send webhooks to localhost:9999
curl -X POST http://localhost:9999/huginn/webhook \
  -H "Content-Type: application/json" \
  -d '{"content":"Message from LLM","type":"alert"}'
```

## Message Types

- `"type": "text"` — Standard message (green)
- `"type": "code"` — Code snippet (blue)
- `"type": "alert"` — Important alert (purple glow)

## Check Status

```bash
# Health check
curl http://localhost:3602/huginn/health

# Server logs
tail -f /tmp/slab.log

# Check server process
ps aux | grep "node.*www.js"
```

## Restart Server

```bash
# Stop server
fuser -k 3602/tcp

# Start server
cd /srv/slab && NODE_ENV=production node bin/www.js > /tmp/slab.log 2>&1 &
```

---

**Full Documentation:** `/srv/slab/HUGINN_WEBHOOK_SETUP.md`
