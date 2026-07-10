#!/usr/bin/env bash
#
# deploy-vps.sh — stand up a VPS-local management MCP so Claude Code (running on
# the WSL/app box) can operate the VPS 104.237.138.28 the same way it operates
# the app box today.
#
# Run ON THE VPS, as root:   bash deploy-vps.sh
#
# It creates an ISOLATED second instance of the existing /srv/mcp streamable
# HTTP server (does NOT touch the running /srv/mcp instance):
#   • code:     /srv/mcp-vps           (copied from /srv/mcp, own node_modules)
#   • env:      /srv/mcp-vps/.env      (own port + own static bearer token)
#   • service:  srv-mcp-vps.service    (systemd, listens 127.0.0.1:$PORT)
#   • vhost:    mcp-vps.madladslab.com (Apache → 127.0.0.1:$PORT, wildcard TLS)
#
# Idempotent: safe to re-run. Uses NO destructive commands.
set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
HOST="mcp-vps.madladslab.com"
PORT="3651"                       # app box uses 3650; keep this distinct
TOKEN="c45276b0a8427de06107430c463a85013df24a7de3b1087ebe7a5a081c46dcd9"
SRC="/srv/mcp"
DST="/srv/mcp-vps"
CERT_DIR="/etc/letsencrypt/live/madladslab.com"

log() { printf '\n\033[1;36m[deploy-vps]\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31m[deploy-vps] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root (sudo bash deploy-vps.sh)"
[ -f "$SRC/mcp-http.js" ] || die "$SRC/mcp-http.js not found — the MCP code must exist at $SRC first (git pull / rsync it)."
command -v node >/dev/null || die "node not on PATH"
NODE_BIN="$(command -v node)"

# ── 1. Copy code into an isolated dir (excluding node_modules + secrets) ──────
log "syncing $SRC → $DST (isolated instance)"
mkdir -p "$DST"
if command -v rsync >/dev/null; then
  rsync -a --delete --exclude 'node_modules' --exclude '.env' --exclude 'vps/' "$SRC"/ "$DST"/
else
  # cp fallback: copy everything, then drop the excluded bits from the COPY only
  cp -a "$SRC"/. "$DST"/
  rm -rf "$DST/node_modules" "$DST/.env" "$DST/vps"
fi

# ── 2. Write this instance's .env (static-bearer auth only) ───────────────────
log "writing $DST/.env"
cat > "$DST/.env" <<ENV
# VPS management MCP — isolated instance (see /srv/mcp/vps/HANDOFF-VPS-MCP.md)
MCP_PORT=$PORT
MCP_STATIC_TOKENS=$TOKEN
MCP_ALLOWED_PATHS=/srv
MCP_COMMAND_TIMEOUT=300000
ENV
chmod 600 "$DST/.env"

# ── 3. Install deps for the isolated instance ─────────────────────────────────
log "installing npm deps in $DST"
( cd "$DST" && (npm ci --omit=dev 2>/dev/null || npm install --omit=dev) )

# ── 4. systemd unit ───────────────────────────────────────────────────────────
log "installing systemd unit srv-mcp-vps.service"
cat > /etc/systemd/system/srv-mcp-vps.service <<UNIT
[Unit]
Description=VPS management MCP (streamable HTTP, isolated) for Claude Code
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DST
ExecStart=$NODE_BIN mcp-http.js
Restart=on-failure
RestartSec=3
# Least-privilege-ish hardening (still needs /srv + tmux + systemctl for its tools)
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now srv-mcp-vps.service

# ── 5. Apache vhost (exact ServerName beats the *.madladslab.com wildcard) ────
log "installing Apache vhost for $HOST"
a2enmod proxy proxy_http ssl headers rewrite >/dev/null 2>&1 || true
CONF="/etc/apache2/sites-available/${HOST}.conf"
cat > "$CONF" <<VHOST
<VirtualHost *:80>
    ServerName ${HOST}
    RewriteEngine On
    RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [R=301,L]
</VirtualHost>

<IfModule mod_ssl.c>
<VirtualHost *:443>
    ServerName ${HOST}

    ProxyPreserveHost On
    RequestHeader set X-Forwarded-Proto "https"
    # Streamable HTTP MCP endpoint
    ProxyPass        / http://127.0.0.1:${PORT}/
    ProxyPassReverse / http://127.0.0.1:${PORT}/

    ErrorLog  \${APACHE_LOG_DIR}/${HOST}-error.log
    CustomLog \${APACHE_LOG_DIR}/${HOST}-access.log combined

    SSLEngine on
    Include /etc/letsencrypt/options-ssl-apache.conf
    SSLCertificateFile ${CERT_DIR}/fullchain.pem
    SSLCertificateKeyFile ${CERT_DIR}/privkey.pem
</VirtualHost>
</IfModule>
VHOST

if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
  log "WARNING: ${CERT_DIR}/fullchain.pem missing — renew the wildcard cert (see HANDOFF Step 0) before the HTTPS vhost will load."
fi

a2ensite "${HOST}.conf" >/dev/null
if apache2ctl configtest 2>&1 | grep -qiv 'Syntax OK'; then
  apache2ctl configtest || die "Apache configtest failed — vhost written to $CONF but NOT reloaded. Fix and 'systemctl reload apache2'."
fi
systemctl reload apache2

# ── 6. Verify + print connection details ──────────────────────────────────────
log "local health check"
sleep 1
curl -fsS "http://127.0.0.1:${PORT}/health" && echo || die "health check failed — 'journalctl -u srv-mcp-vps -n 50'"

cat <<DONE

============================================================================
 VPS management MCP is up.
============================================================================
  Local:      http://127.0.0.1:${PORT}/mcp   (health: /health)
  Public:     https://${HOST}/mcp
  Auth:       Authorization: Bearer ${TOKEN}

  DNS (once):  add an A record  ${HOST}  ->  104.237.138.28  (Linode DNS)
               the wildcard cert already covers *.madladslab.com.

  Register from the app box (Claude Code):
    claude mcp add --transport http srv-vps https://${HOST}/mcp \\
      --header "Authorization: Bearer ${TOKEN}"

  Smoke test from anywhere:
    curl https://${HOST}/health
    curl -X POST https://${HOST}/mcp \\
      -H "Authorization: Bearer ${TOKEN}" \\
      -H "Content-Type: application/json" \\
      -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

  Manage:
    systemctl status srv-mcp-vps
    journalctl -u srv-mcp-vps -f
============================================================================
DONE
