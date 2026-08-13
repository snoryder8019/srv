# Claude MCP Context - /srv VM Management

**Last Updated:** July 20, 2026
**Purpose:** MCP server for Claude Android app to manage /srv VM safely

---

## ⚠️ SUPERVISION CHANGED: tmux → systemd

**As of July 2026, /srv services are supervised by systemd, not tmux.** There is no
tmux server running on this box. Every app has its own unit in `/etc/systemd/system/`:

`srv-slab` (3602), `srv-cards`, `srv-codevs`, `srv-games`, `srv-madlands`,
`srv-matchmaking`, `srv-mcp`, `srv-mllOauth`, `srv-mllPitches`, `srv-opsTrain`,
`srv-piper-tts`, `srv-reels`, `srv-td`, `srv-tiles`, `srv-triple-twenty`, `graffiti-tv`.

Units are `Type=simple`, `User=root`, `Restart=always`, with `PORT` and
`EnvironmentFile=-<app>/.env` set in the unit.

**Use these instead of any tmux tool:**

```bash
sudo -n systemctl restart srv-slab.service                # restart
sudo -n systemctl status  srv-slab.service --no-pager     # status
sudo -n journalctl -u srv-slab.service -n 100 --no-pager  # logs
ss -ltn | grep :3602                                      # confirm listening
```

The `tmux_*` and `restart_service_safe` tools in this MCP server are **stale** — they
target a tmux layer that no longer exists. Do not start services by hand
(`node bin/www.js`, `setsid nohup …`) either: systemd owns the ports, and a manual
launch just crash-loops the unit on `EADDRINUSE`. The tmux sections below are retained
for historical reference only.

---

## 🎯 What This Is

An MCP (Model Context Protocol) server that allows your Claude Android app to:
- Execute commands on the VM safely
- Read and write files in `/srv`
- Inspect and restart systemd services without crashing them
- Monitor service status on various ports
- Restart services safely (NEVER using killall)

## 🚨 Safety First

Safety rules for this box. (An earlier version cited `/srv/ps/docs/CLAUDE.md` as
the source of these rules; that file no longer exists.)

### Forbidden Forever
- ❌ `killall node` — kills every service on the box
- ❌ `pkill -9` without a specific, verified target
- ❌ `rm -rf /` or similar destructive commands
- ❌ `dd`, `mkfs`, `reboot`, `shutdown`
- ❌ `/srv/start-all-services.sh` — **STALE AND HARMFUL.** It still launches tmux
  sessions running `node bin/www.js` on ports systemd already owns — slab:3602,
  games:3500, graffiti-tv:3001, opsTrain:3603 all collide. Running it spawns port
  squatters that crash-loop on `EADDRINUSE`. (Its other entries — madladslab,
  greealitytv, nocometalworkz — point at directories that no longer exist and just
  fail.) Do not run it.
- ❌ `lsof -ti:PORT | xargs kill -9` — units are `Restart=always`, so this does not
  stop a service. systemd respawns it in ~4s. It is an uncontrolled bounce, not a stop.
- ❌ `tmux kill-session -t NAME` — no-op; there is no tmux server on this box.

### Always Do This Instead
- ✅ `sudo -n systemctl restart srv-<app>.service` — restart one service
- ✅ `sudo -n systemctl stop srv-<app>.service` — actually stop it (respects Restart=always)
- ✅ `sudo -n systemctl start srv-<app>.service` — start it back up
- ✅ `sudo -n journalctl -u srv-<app>.service -n 100 --no-pager` — read its logs
- ✅ `ss -ltnp | grep :<port>` — see who really holds a port
- ✅ To restart everything: loop the units, never the old script —
  `for u in /etc/systemd/system/srv-*.service; do sudo -n systemctl restart "$(basename "$u")"; done`

## 🛠️ Available Tools

Eleven tools, identical in both `server.js` and `mcp-http.js`. **Five are stale** —
they target the retired tmux layer and no longer do anything useful on this box.

### File Management
1. **read_file** — read any file under the allowed paths
2. **write_file** — write content to files
3. **list_directory** — browse directories

### Tmux Management — ⚠️ ALL STALE
4. ~~**tmux_list_sessions**~~ — always empty; no tmux server runs
5. ~~**tmux_session_status**~~ — always "not found"
6. ~~**tmux_capture_logs**~~ — no sessions to capture; use `journalctl` instead

### Service Control
7. **service_status** — check if a port is listening (still works)
8. ~~**restart_service_safe**~~ — ⚠️ STALE: restarts *via tmux*, so it has nothing
   to restart. Use `systemctl restart srv-<app>.service`.
9. ~~**emergency_restart_all**~~ — ⚠️ STALE AND HARMFUL: shells into
   `/srv/start-all-services.sh`, which spawns tmux port-squatters. See Safety First.

### Command Execution
10. **execute_command** — run bash commands with safety checks
11. **get_claude_context** — load a CLAUDE.md for project context

To restart or inspect a service, use `execute_command` with `systemctl` /
`journalctl` rather than tools 4–6, 8, or 9.

## 📡 How The Server Actually Runs

The live server is **`mcp-http.js`, an HTTP server on 127.0.0.1:3650**, supervised by
systemd as `srv-mcp.service`. It is *not* launched over SSH stdio, and *not* started
by `start-mcp.sh`.

```bash
sudo -n systemctl status srv-mcp.service --no-pager
sudo -n systemctl restart srv-mcp.service
sudo -n journalctl -u srv-mcp.service -n 100 --no-pager
curl -s http://127.0.0.1:3650/health
```

Endpoints: `GET /health` (unauthenticated), `POST /mcp` and `GET /mcp` (both behind
`authenticate`). It binds loopback only, so remote access requires a
reverse proxy or tunnel in front of it.

Config lives in `/srv/mcp/.env`: `MCP_STATIC_TOKENS`, `MCP_OAUTH_PUBLIC_KEY`,
`MCP_OAUTH_ISSUER`, `MCP_RESOURCE`, `MCP_PROTECTED_RESOURCE_METADATA`,
`MCP_ALLOWED_PATHS`, `MCP_COMMAND_TIMEOUT`.

> **Stale by comparison:** `server.js` (the stdio variant, `npm start`) and
> `start-mcp.sh` (which launches it in a tmux session) are both leftovers from the
> tmux era. `package.json` still declares `"main": "server.js"`. Neither is what
> systemd runs.

## 📊 Known Services

Ports and directories as defined by the systemd units, verified July 20 2026:

| Unit | Port | Directory |
|------|------|-----------|
| srv-slab | 3602 | /srv/slab |
| srv-games | 3500 | /srv/games |
| srv-cards | 3600 | /srv/cards |
| srv-opsTrain | 3603 | /srv/opsTrain |
| srv-mllPitches | 3608 | /srv/mllPitches |
| srv-matchmaking | 3610 | /srv/matchmaking |
| srv-codevs | 3620 | /srv/coDevs |
| srv-tiles | 3625 | /srv/tiles |
| srv-mcp | 3650 | /srv/mcp |
| srv-mllOauth | 3651 | /srv/mllOauth |
| srv-triple-twenty | 3710 | /srv/triple-twenty |
| srv-td | 3720 | /srv/td |
| srv-madlands | 3730 | /srv/games/arcade/madlands |
| srv-reels | 3740 | /srv/reels |
| srv-piper-tts | 8091 | /srv/piper-tts |
| graffiti-tv | 3001 | /srv/graffiti-tv |

Authoritative check, rather than trusting this table:
`grep -H 'PORT=' /etc/systemd/system/*.service` and `ss -ltnp`.

> **Retired:** `ps` (3399, Stringborn Universe), `madladslab` (3000),
> `nocometalworkz` (3002), `greealitytv` (3400) and `acm` were listed here for years.
> None of those directories exist under `/srv` anymore and nothing listens on those
> ports. `game-state` is now `srv-games` on 3500.

## 🔒 Security

### Path Restrictions
- Access limited to the paths in `MCP_ALLOWED_PATHS` (`.env`)
- All paths validated before operations

### Command Protection
Automatic rejection of:
- killall, pkill -9
- rm -rf /
- dd, mkfs
- reboot, shutdown

### Resource Limits
- 10MB max file size (`MAX_FILE_SIZE`)
- 30 second default command timeout (overridable per call; `MCP_COMMAND_TIMEOUT`)
- 5MB max output buffer

## 🐛 Common Issues

### "Connection failed"
- Check the unit: `sudo -n systemctl status srv-mcp.service --no-pager`
- Check it's listening: `ss -ltn | grep :3650`
- Probe it: `curl -s http://127.0.0.1:3650/health`
- Remember it binds 127.0.0.1 only — remote clients need the proxy/tunnel to be up

### "Unauthorized" / 401
- `POST /mcp` and `GET /mcp` require auth; `/health` does not
- Check `MCP_STATIC_TOKENS` / the OAuth vars in `/srv/mcp/.env`

### "Command timed out"
- 30s default; pass an explicit `timeout` (ms) for long commands
- Logs: `sudo -n journalctl -u srv-mcp.service -n 100 --no-pager`

### "Access denied"
- Path must be absolute and inside `MCP_ALLOWED_PATHS`

### A tmux tool returned nothing
- Expected. There is no tmux server. Use `systemctl` / `journalctl`.

## 📚 Related Files

- `/srv/mcp/README.md` — full documentation (⚠️ still describes the tmux era)
- `/srv/mcp/mcp-http.js` — the server that actually runs (systemd `srv-mcp.service`)
- `/srv/mcp/server.js` — stdio variant, not currently used
- `/etc/systemd/system/srv-*.service` — the real service definitions
- `/srv/start-all-services.sh` — ⚠️ stale tmux launcher, do not run

---

*Supervision moved from tmux to systemd in July 2026. Restart services with
`systemctl`, never with `killall`, `kill -9`, or `start-all-services.sh`.*
