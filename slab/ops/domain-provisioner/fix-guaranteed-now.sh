#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# fix-guaranteed-now.sh — one-shot: route guaranteedlandscaper.com to Slab and
# issue its TLS cert, right now, on the VPS. No service, no dry-run.
#
# RUN ON THE VPS (104.237.138.28) AS ROOT:  sudo bash fix-guaranteed-now.sh
#
# What it does:
#   1. Writes an HTTP vhost for the domain that serves the ACME challenge
#      locally and proxies everything else to Slab (3602) — this alone STOPS
#      the fall-through to the cards default vhost (ServerName now matches).
#   2. Issues a Let's Encrypt cert via webroot (apex + www, falls back to apex).
#   3. Writes the HTTPS vhost (TLS + websocket proxy to Slab).
#   4. configtest + reload after each step.
# Idempotent-ish: re-running overwrites the two conf files and re-runs certbot
# (--keep-until-expiring, so it won't re-issue a valid cert).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
[ "$(id -u)" = "0" ] || { echo "run as root: sudo bash fix-guaranteed-now.sh"; exit 1; }

DOMAIN=guaranteedlandscaper.com
WWW=www.$DOMAIN
TUNNEL=127.0.0.1:3602
WEBROOT=/var/www/acme
EMAIL=admin@madladslab.com
SITES=/etc/apache2/sites-available

echo "[1/5] prereqs"
a2enmod ssl proxy proxy_http proxy_wstunnel rewrite headers >/dev/null 2>&1 || true
command -v certbot >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y certbot >/dev/null; }
mkdir -p "$WEBROOT/.well-known/acme-challenge"; chown -R www-data: "$WEBROOT"

echo "[2/5] HTTP vhost (serves ACME, proxies rest to Slab — ends cards routing)"
cat > "$SITES/tenant-$DOMAIN.conf" <<CONF
<VirtualHost *:80>
    ServerName $DOMAIN
    ServerAlias $WWW
    Alias /.well-known/acme-challenge/ $WEBROOT/.well-known/acme-challenge/
    <Directory $WEBROOT/.well-known/acme-challenge>
        Require all granted
    </Directory>
    ProxyPreserveHost On
    ProxyPass /.well-known/acme-challenge/ !
    RequestHeader set X-Forwarded-Proto "http"
    ProxyPass        / http://$TUNNEL/
    ProxyPassReverse / http://$TUNNEL/
    ErrorLog \${APACHE_LOG_DIR}/tenant-$DOMAIN-error.log
</VirtualHost>
CONF
a2ensite "tenant-$DOMAIN.conf" >/dev/null 2>&1 || true
apache2ctl configtest && systemctl reload apache2
echo "    → http://$DOMAIN now proxies to Slab (no longer cards)"

echo "[3/5] issue cert (apex + www, fallback apex-only)"
if ! certbot certonly --webroot -w "$WEBROOT" --non-interactive --agree-tos --keep-until-expiring \
      -m "$EMAIL" -d "$DOMAIN" -d "$WWW"; then
  echo "    www failed — retrying apex-only"
  certbot certonly --webroot -w "$WEBROOT" --non-interactive --agree-tos --keep-until-expiring \
      -m "$EMAIL" -d "$DOMAIN"
fi

echo "[4/5] HTTPS vhost (TLS + websocket proxy to Slab)"
# Only advertise www on TLS if the cert actually covers it.
ALIAS=""
if openssl x509 -in "/etc/letsencrypt/live/$DOMAIN/cert.pem" -noout -text 2>/dev/null | grep -q "DNS:$WWW"; then
  ALIAS="ServerAlias $WWW"
fi
cat > "$SITES/tenant-$DOMAIN-ssl.conf" <<CONF
<VirtualHost *:443>
    ServerName $DOMAIN
    $ALIAS
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/$DOMAIN/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/$DOMAIN/privkey.pem
    ProxyPreserveHost On
    ProxyTimeout 300
    RequestHeader set X-Forwarded-Proto "https"
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://$TUNNEL/\$1 [P,L]
    ProxyPass        / http://$TUNNEL/
    ProxyPassReverse / http://$TUNNEL/
    ErrorLog \${APACHE_LOG_DIR}/tenant-$DOMAIN-ssl-error.log
    CustomLog \${APACHE_LOG_DIR}/tenant-$DOMAIN-ssl-access.log combined
</VirtualHost>
CONF
a2ensite "tenant-$DOMAIN-ssl.conf" >/dev/null 2>&1 || true
apache2ctl configtest && systemctl reload apache2

echo "[5/5] verify"
echo -n "    HTTPS title: "; curl -s -k "https://$DOMAIN/" | grep -oiE "<title>[^<]*</title>" | head -1 || true
echo "DONE — https://$DOMAIN should now serve GUARANTEED LANDSCAPING LLC."
