#!/usr/bin/env bash
LOG=/srv/mcp/_bounce.log
GOOD=/srv/mcp/mcp-http.js.bak-1784560917   # pre-greeting-edit original (known good)
echo "[$(date -Is)] bounce start (deploying greeting/description changes)" >> "$LOG"
systemctl restart srv-mcp
sleep 5
if systemctl is-active --quiet srv-mcp && curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3650/health; then
  echo "[$(date -Is)] OK: srv-mcp active and /health responding -> NEW build live (v2.1.0)" >> "$LOG"
else
  echo "[$(date -Is)] FAIL: new build unhealthy -> rolling back to original" >> "$LOG"
  cp "$GOOD" /srv/mcp/mcp-http.js
  systemctl restart srv-mcp
  sleep 5
  if systemctl is-active --quiet srv-mcp && curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3650/health; then
    echo "[$(date -Is)] ROLLED BACK: original restored, srv-mcp healthy again" >> "$LOG"
  else
    echo "[$(date -Is)] CRITICAL: still unhealthy after rollback; needs manual check" >> "$LOG"
  fi
fi
