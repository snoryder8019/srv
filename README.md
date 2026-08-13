# MadLadsLab `/srv` — Service Index

Authoritative map of services in `/srv`, their systemd units, ports, and working directories.
Last reconciled with running state on **2026-07-20**.

> **Host:** WSL2 Ubuntu on the **Greeley** GPU box (Windows host `DESKTOP-2VRPOAO`), kernel `*-microsoft-standard-WSL2`.
> **Process manager:** **systemd** (migrated off tmux + the Linode VPS, 2026-07).
> Sibling docs: [QUICK_START.md](./QUICK_START.md) · [SERVICE_MONITOR_README.md](./SERVICE_MONITOR_README.md) · [TMUX_CHEATSHEET.md](./TMUX_CHEATSHEET.md) (deprecated) · [HANDOFF-wsl-bridge.md](./HANDOFF-wsl-bridge.md) (migration record)

---

## Active Services

Every app is a **systemd unit**. Verified live against `systemctl` + `ss -lntp` on 2026-07-20
(unit → port → working directory are exact; domains marked *unverified* still need a pass against
`/etc/apache2/sites-enabled/`).

| Service | systemd unit | Port | Working directory | Domain |
|---------|--------------|------|-------------------|--------|
| slab | `srv-slab` | 3602 | `/srv/slab` | madladslab.com (+ www, wildcard, tenants: mobilemeadows, nocometalworkz.com, w2marketing.biz) |
| games (portal/IdP) | `srv-games` | 3500 (localhost) | `/srv/games` | games.madladslab.com |
| cards (arcade platform) | `srv-cards` | 3600 | `/srv/games/arcade/cards` | cards.madladslab.com |
| matchmaking | `srv-matchmaking` | 3610 | `/srv/games/matchmaking` | match.madladslab.com |
| tiles (arcade platform) | `srv-tiles` | 3625 | `/srv/games/arcade/tiles` | tiles.madladslab.com |
| td / Towers | `srv-td` | 3720 | `/srv/games/arcade/td` | towers.madladslab.com |
| madlands (arcade) | `srv-madlands` | 3730 | `/srv/games/arcade/madlands` | *unverified* |
| reels (arcade) | `srv-reels` | 3740 | `/srv/games/arcade/reels` | *unverified* |
| triple-twenty | `srv-triple-twenty` | 3710 | `/srv/triple-twenty` | tripletwenty.madladslab.com |
| opsTrain | `srv-opsTrain` | 3603 | `/srv/opsTrain` | ops-train.madladslab.com |
| graffiti-tv | `graffiti-tv` (no `srv-` prefix) | 3001 | `/srv/graffiti-tv` | graffititv.madladslab.com |
| mllPitches | `srv-mllPitches` | 3608 | `/srv/mllPitches` | *unverified* |
| coDevs | `srv-codevs` | 3620 | `/srv/coDevs` | *unverified* |
| mllOauth (claude.ai connector auth) | `srv-mllOauth` | 3651 | `/srv/mllOauth` | issuer for mcp.madladslab.com OAuth |
| mcp (this connector) | `srv-mcp` | 3650 (localhost) | `/srv/mcp` | mcp.madladslab.com |
| piper-tts | `srv-piper-tts` | 8091 (localhost) | `/srv/piper-tts` | internal (ollama stack) |

> **Arcade note:** the game platforms live *under* `/srv/games/arcade/*` (cards, tiles, td, madlands, reels)
> plus `/srv/games/matchmaking` — **not** at top-level `/srv/cards`, `/srv/td`, etc. Older docs (and the
> games `ARCHITECTURE.md` topology table) show the wrong top-level paths; trust the table above.

There is also a `winhost-alias.service` (oneshot) that points the `winhost` hostname at the Windows host
(the WSL gateway) so slab tenants can reach Mongo/MinIO on the Greeley box.

---

## Service Management (systemd)

```bash
systemctl list-units --type=service 'srv-*'     # all srv apps + state
systemctl status  srv-<name>                    # one service
systemctl is-active srv-<name>                   # quick up/down
journalctl -u srv-<name> -n 100 --no-pager       # recent logs
journalctl -u srv-<name> -f                      # follow logs
systemctl restart srv-<name>                     # restart one service
```

- **Restarting `srv-mcp` drops the live MCP/Claude connection** (its session map is in-memory) — expect to reconnect.
- Units set `Restart=` so systemd self-heals crashes; no external watchdog needed.
- `systemctl stop|disable|mask`, `reboot`, `shutdown`, `killall`/`pkill`/`kill -9` are blocked through the MCP
  `execute_command` tool by design. `systemctl restart`/`status` and `journalctl` are allowed.

### Legacy (pre-migration) — do not use
`/srv/start-all-services.sh`, `/srv/service-watchdog.json`, `/srv/auto-start-npm.json`, `/srv/monitor-services.sh`
and the whole tmux workflow are **superseded by systemd units** and kept only for reference. The MCP's `tmux_*`
tools, `restart_service_safe`, and `emergency_restart_all` are likewise legacy and will find nothing running.

---

## Shared Infrastructure

- **Host / runtime:** WSL2 Ubuntu on the Greeley GPU box; systemd is PID 1 (`/etc/wsl.conf` → `[boot] systemd=true`).
- **Windows keepalive:** a `snory` S4U scheduled task (`WslServer`) boots the distro headless at Windows startup.
- **DB:** MongoDB Atlas (`madLadsLab`) for slab/opsTrain/games; slab tenants reach local Mongo via `winhost`.
- **AI API:** `https://ollama.madladslab.com` → local inference on the Greeley box.
- **Auth:** Google OAuth + Passport.js (slab, opsTrain, games); Slab gateway SSO via [gateway.cjs](./gateway.cjs);
  claude.ai MCP connector auth via `srv-mllOauth` (RS256 JWT) → `srv-mcp`.
- **Web server:** Apache 2.4 + Let's Encrypt, terminating TLS and reverse-proxying each subdomain to its loopback port.
- **Ingress (endgame):** VPS Apache is being demoted to a thin forwarder into WSL; see [HANDOFF-wsl-bridge.md](./HANDOFF-wsl-bridge.md).

### Apache vhost convention
- `/srv/slab` owns the landing page and all tenant subdomains via the wildcard cert (`slab-wildcard*.conf`).
- Every other service gets its own dedicated vhost conf in `/etc/apache2/sites-available/` — never piggyback on the wildcard.
- WebSocket upgrade must be declared explicitly per vhost (`ProxyPass .../socket.io/ upgrade=websocket`).

### Apache security baseline
Global via `/etc/apache2/conf-enabled/block-scanners.conf`: drop PHP/WordPress/shell/dotfile probes and empty-UA
requests; set `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`, `Referrer-Policy`,
HSTS (HTTPS only); unset `Server`/`X-Powered-By`. Per-vhost overrides only for stricter policy (e.g. CSP).

---

## Cleanup owed / re-verify

Carried over from the pre-migration audit — **re-verify against `sites-enabled` now that the host moved:**

- Apache vhosts still pointing at deprecated/retired backends (madladslab, madThree, sna, twww, bih, sfg,
  w2marketing mongo, preview, duplicate towers conf) will 502 if hit. Confirm which are enabled on this host.
- The legacy tmux/watchdog artifacts listed above should be moved to `_archive/` or deleted once nothing references them.
- `.service-monitor/*.down` flags from the retired tmux monitor are stale.
- Domains marked *unverified* in the table (madlands, reels, mllPitches, coDevs, mllOauth) need a `sites-enabled` pass.

---

## Adding a New Service — Checklist (systemd)

1. Create the app dir (under `/srv/…`; arcade games go under `/srv/games/arcade/<name>`) and pick an unused port.
2. Ensure `package.json`/entry runs production-mode node (not a file-watcher).
3. Create `/etc/systemd/system/srv-<name>.service` (`ExecStart=/usr/bin/node <entry>`, `WorkingDirectory=`,
   `Restart=always`, `WantedBy=multi-user.target`), then `systemctl daemon-reload && systemctl enable --now srv-<name>`.
4. Apache: dedicated vhost conf in `sites-available/`, `a2ensite`, `certbot --apache -d <domain>` (security headers are global).
5. Add a row to the Active Services table above.

---

## Contact / Ownership
- **Operator:** scott@madladslab.com
- **Internal use only** — MadLabs Lab
