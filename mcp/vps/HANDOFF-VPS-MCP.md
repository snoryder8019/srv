# HANDOFF — VPS management MCP (so we can drive 104.237.138.28 from here)

**Created:** 2026-07-08

**Why:** Claude Code runs on the app box (DESKTOP-2VRPOAO, 76.155.250.221). The
existing `claude_srv_v2` connector executes on THAT box only. TLS, Apache and the
Let's Encrypt certs live on the Linode VPS 104.237.138.28 (madladslab.com,
/srv/slab, /etc/letsencrypt). We currently have no programmatic access to the VPS
from here (SSH publickey denied for the agent), which is why the expired wildcard
cert cannot be fixed from this side.

This handoff stands up a small VPS-local MCP — an isolated second copy of the
/srv/mcp streamable-HTTP server — so that, once running, this environment can
operate the VPS (run commands, read logs, restart services, renew certs) exactly
like it does the app box.

You run two things on the VPS by hand (you have SSH); after that everything is
reachable from here.

---

## Topology (confirmed 2026-07-08)

```
Claude Code  ─┐
              │  claude_srv_v2 (existing)  --> app box  DESKTOP-2VRPOAO / 76.155.250.221
              │                                  node app :3602, /srv/mcp streamable :3650
              │
              └  srv-vps (NEW, this handoff) --> VPS  104.237.138.28 (madladslab.com)
                                                 Apache + TLS + certbot, /srv/slab,
                                                 NEW /srv/mcp-vps streamable :3651
```

`upland-ts.madladslab.com` (and every `*.madladslab.com` site) resolves to the
VPS. The public site is served by the VPS's own /srv/slab, NOT this box — so code
edits made here are not live there until the migration completes.

---

## Step 0 — IMMEDIATE: renew the expired wildcard cert (fixes the outage)

This is the actual cause of ERR_CERT_DATE_INVALID on upland-ts.madladslab.com and
every other subdomain. The served cert is CN=*.madladslab.com, valid
Mar 25 -> Jun 23 2026 — expired. Subdomains are NOT individually issued a cert;
they ride this one wildcard. Do this now, on the VPS:

```bash
ssh root@104.237.138.28

# 1. See how the cert renews (note the "Authenticator" line)
certbot certificates
grep -i authenticator /etc/letsencrypt/renewal/madladslab.com.conf

# 2a. If authenticator is a DNS plugin (e.g. dns-linode) -- just renew:
certbot renew --cert-name madladslab.com --force-renewal
systemctl reload apache2

# 2b. If it says "manual" (no plugin) -- reissue via the Linode DNS plugin so it
#     auto-renews from now on. LINODE token is in /srv/slab/.env (LINODE_API_TOKEN):
apt-get install -y python3-certbot-dns-linode
umask 077
printf 'dns_linode_key = %s\ndns_linode_version = 4\n' "REPLACE_WITH_LINODE_TOKEN" > /etc/letsencrypt/linode.ini
certbot certonly --dns-linode --dns-linode-credentials /etc/letsencrypt/linode.ini -d madladslab.com -d '*.madladslab.com' --cert-name madladslab.com
systemctl reload apache2

# 3. Make sure auto-renew is armed so this never lapses again
systemctl enable --now certbot.timer
systemctl list-timers | grep certbot
```

Verify: `curl -sI https://upland-ts.madladslab.com | head -1` gives HTTP/2 200,
and an openssl check shows a fresh notAfter.

> The whole reason for Steps 1-3 below is so that NEXT time this is a one-liner
> from here instead of a manual SSH session.

---

## Step 1 — install the VPS MCP (one command on the VPS)

The installer is self-contained; the only prerequisite is that the existing MCP
code is present at /srv/mcp on the VPS (it is — that's the origin box).

Copy deploy-vps.sh to the VPS and run it as root:

```bash
scp /srv/mcp/vps/deploy-vps.sh root@104.237.138.28:/root/
ssh root@104.237.138.28 'bash /root/deploy-vps.sh'
```

What it does (idempotent, no destructive commands):
- copies /srv/mcp -> /srv/mcp-vps (own node_modules, own .env) so the existing
  /srv/mcp instance is untouched;
- writes /srv/mcp-vps/.env with MCP_PORT=3651 and a dedicated static bearer token
  (static-bearer auth only — no OAuth needed for Claude Code);
- installs and starts srv-mcp-vps.service (systemd, 127.0.0.1:3651);
- installs the mcp-vps.madladslab.com Apache vhost (exact ServerName wins over
  the *.madladslab.com wildcard, so it routes locally on the VPS, not through the
  tunnel) using the wildcard TLS cert;
- runs a local health check and prints the connect command.

## Step 2 — DNS (one time)

Add an A record in Linode DNS:

```
mcp-vps.madladslab.com.  A  104.237.138.28
```

No new cert needed — *.madladslab.com (renewed in Step 0) already covers it.

## Step 3 — register the connector from THIS box

```bash
claude mcp add --transport http srv-vps https://mcp-vps.madladslab.com/mcp --header "Authorization: Bearer c45276b0a8427de06107430c463a85013df24a7de3b1087ebe7a5a081c46dcd9"
```

(For the claude.ai web UI: Settings -> Connectors -> Add custom connector ->
https://mcp-vps.madladslab.com/mcp . The web UI prefers OAuth; the static-bearer
path above is the reliable one for Claude Code / curl / the API.)

Smoke test:

```bash
curl https://mcp-vps.madladslab.com/health
curl -X POST https://mcp-vps.madladslab.com/mcp -H "Authorization: Bearer c45276b0a8427de06107430c463a85013df24a7de3b1087ebe7a5a081c46dcd9" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Once registered, this environment gets the same toolset ON THE VPS:
execute_command, read_file, write_file, list_directory, service_status,
restart_service_safe, tmux_*, get_claude_context — scoped to /srv, with the same
forbidden-command guards (killall, destructive removes, reboot, ...).

---

## Security notes
- The bearer token in this doc / deploy-vps.sh grants /srv-scoped command
  execution on the VPS. Treat it as a secret. To rotate: edit MCP_STATIC_TOKENS
  in /srv/mcp-vps/.env, run `systemctl restart srv-mcp-vps`, and re-run
  `claude mcp add` with the new value.
- The server only binds 127.0.0.1:3651; the only way in is through the Apache
  vhost over TLS, which requires the bearer token.
- Same sandbox as the app-box MCP: paths restricted to /srv, 10 MB file cap,
  command timeout (300 s here), destructive commands rejected.

## Files in this handoff
- deploy-vps.sh — self-contained installer (run on the VPS as root).
- HANDOFF-VPS-MCP.md — this document.

## Rollback
```bash
systemctl disable --now srv-mcp-vps.service
rm -f /etc/systemd/system/srv-mcp-vps.service && systemctl daemon-reload
a2dissite mcp-vps.madladslab.com.conf && systemctl reload apache2
rm -rf /srv/mcp-vps
# (leaves /srv/mcp and the running :3650 instance untouched)
```
