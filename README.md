# MadLadsLab `/srv` — Service Index

Authoritative map of services in `/srv`, their ports, tmux sessions, and Apache vhosts.
Last reconciled with running state on **2026-05-14**.

> Sibling docs: [QUICK_START.md](./QUICK_START.md) · [TMUX_CHEATSHEET.md](./TMUX_CHEATSHEET.md) · [SERVICE_MONITOR_README.md](./SERVICE_MONITOR_README.md)

---

## Active Services

All services run under tmux. Verified against `tmux ls`, `ss -lntp`, and `/etc/apache2/sites-enabled/`.

| Service | Port | tmux Session | Directory | Public Domain(s) |
|---------|------|--------------|-----------|------------------|
| **slab** | 3602 | `slab` | [slab/](./slab/) | madladslab.com, www.madladslab.com, *.madladslab.com (wildcard), slab.madladslab.com, mobilemeadows.madladslab.com, nocometalworkz.com, w2marketing.biz |
| **games** | 3500 (127.0.0.1) | `games` | [games/](./games/) | games.madladslab.com |
| **ps** | 3399 | `ps_session` | [ps/](./ps/) | ps.madladslab.com |
| **opsTrain** | 3603 | `opsTrain_session` | [opsTrain/](./opsTrain/) | ops-train.madladslab.com |
| **graffiti-tv** | 3001 | `graffiti-tv` | [graffiti-tv/](./graffiti-tv/) | graffititv.madladslab.com |
| **greealitytv** | 3400 | `greealitytv` | [greealitytv/](./greealitytv/) | greealitytv.com |
| **game-state-service** | 3502 | `game-state-service_session` | [game-state-service/](./game-state-service/) | svc.madladslab.com |
| **mcp** (mcp-http) | 3650 | `mcp-streamable` / `mcp_session` | [mcp/](./mcp/) | mcp.madladslab.com |
| **triple-twenty** | 3710 | `triple-twenty_session` | [triple-twenty/](./triple-twenty/) | tripletwenty.madladslab.com |
| **piper-tts** | 8091 (127.0.0.1) | `piper-tts_session` | [piper-tts/](./piper-tts/) | internal (used by ollama stack) |

### Defined but not currently running

| Service | Port | Directory | Apache | Notes |
|---------|------|-----------|--------|-------|
| **td** (towers/dust) | 3700 | [td/](./td/) | towers.madladslab.com | No tmux session; vhost will 502 until started |
| **servers** | 3600 | [servers/](./servers/) | (none enabled) | Admin dashboard; no active vhost — was on servers.madladslab.com, that vhost still exists but the service is idle |

### Recently deprecated (2026-05-14)

Moved to `/srv/depricated/new/` via [depricated/deprecate.sh](./depricated/deprecate.sh) and Apache vhosts disabled with `a2dissite`.

| Service | Last Port | Apache vhost | Notes |
|---------|-----------|--------------|-------|
| familyCalendar | 3611 | disabled | Retired |
| on-the-fly | 3655 | disabled | Retired |
| mobile-meadows | 3700 (unused) | **kept** — mobilemeadows.madladslab.com → :3602 (slab) | Now a Slab tenant |
| media-hasher | 3604 | disabled | Retired |
| acm | 3004 | disabled (acm + acm-le-ssl) | acmcreativeconcepts.com — retired |

### Other top-level dirs (not Node services)

- [depricated/](./depricated/) — staging tree for retired apps (`bih`, `sna`, `twww`, `w2Marketing`, `madladslab`, `madThree`, `nocometalworkz`, `legacy-madladslab`, plus `deletion-stage/`). **Do not start anything from here.**
- [scripts/](./scripts/) — security digest, ollama health monitor, vscode watchdog
- [users/](./users/) — encrypted per-user access blobs
- [mcp/](./mcp/), [.service-monitor/](./.service-monitor/) — runtime state
- [roamingNPCs/](./roamingNPCs/) — idea doc only
- [gateway.cjs](./gateway.cjs) — shared Slab superadmin SSO middleware (drop-in for any /srv app)

---

## Shared Infrastructure

- **DB**: MongoDB Atlas (`madLadsLab` DB) — primary store for ps, opsTrain, slab tenants
- **AI API**: `https://ollama.madladslab.com` → `localhost:11400` (image gen, LLM chat; see auto-memory `ai-api.md`)
- **Auth**: Google OAuth + Passport.js across slab, ps, opsTrain; Slab gateway SSO via [gateway.cjs](./gateway.cjs)
- **Web server**: Apache 2.4 + Let's Encrypt (auto-renew)
- **Process manager**: tmux (never PM2, never `killall node`)
- **Host**: single Linode, 15 GB RAM / 6 cores / 315 GB disk

### Apache vhost convention

- **`/srv/slab`** owns the MadLadsLab landing page AND serves all tenant subdomains via the wildcard cert (`slab-wildcard*.conf`) — branded HTTPS per tenant is dynamic, so the OAuth + cert paths live there.
- **Every directory outside `/srv/slab`** gets its own dedicated vhost conf in `/etc/apache2/sites-available/`. Do not extend the wildcard to cover them — each app owns its own domain and its own conf file. This is why `family-calendar` and `on-the-fly` were extracted out of slab.

### Apache security baseline

Global, applied to every vhost via [`/etc/apache2/conf-enabled/block-scanners.conf`](file:///etc/apache2/conf-enabled/block-scanners.conf):

- Drop PHP / WordPress / shell / dotfile probes (`Require all denied`)
- Drop requests with empty `User-Agent`
- `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `X-XSS-Protection`, `Referrer-Policy`
- `Strict-Transport-Security` (gated to HTTPS only via `expr=%{HTTPS} == 'on'`)
- Unset `Server` and `X-Powered-By`

Per-vhost overrides only when a site needs something stricter (e.g. `Content-Security-Policy`).

---

## Service Management

```bash
tmux ls                                  # list sessions
tmux attach -t <session>                 # view a service
tmux capture-pane -t <session> -p | tail # quick log peek
tmux kill-session -t <session>           # stop
bash /srv/start-all-services.sh          # start all (see warnings below)
bash /srv/start-all-services.sh --restart-only
```

Per-service config used by the watchdog: [auto-start-npm.json](./auto-start-npm.json) (current),
[service-watchdog.json](./service-watchdog.json) (**stale — see Dead Ends**).

---

## Apache Vhosts → Backend Map

Active and correctly routed:

| Domain | → Port | Service |
|--------|--------|---------|
| madladslab.com (+ www, wildcard) | 3602 | slab |
| slab.madladslab.com | 3602 | slab |
| mobilemeadows.madladslab.com | 3602 | slab (as tenant) |
| nocometalworkz.com | 3602 | slab |
| w2marketing.biz | 3602 | slab |
| ps.madladslab.com | 3399 | ps |
| games.madladslab.com | 3500 | games |
| ops-train.madladslab.com | 3603 | opsTrain |
| svc.madladslab.com | 3502 | game-state-service |
| mcp.madladslab.com | 3650 | mcp |
| tripletwenty.madladslab.com | 3710 | triple-twenty |
| graffititv.madladslab.com | 3001 | graffiti-tv |
| greealitytv.com | 3400 | greealitytv |
| ollama.madladslab.com | 11400 | ollama (system service) |

---

## Conflicts and Dead Ends

These should be cleaned up; flagging here so they're not forgotten.

### 1. Apache vhosts that point at deleted/deprecated apps

These configs are still enabled in `/etc/apache2/sites-enabled/` but their backend dir is gone (moved to `/srv/depricated/`) and nothing is listening on the proxied port. They will 502 if anyone hits them:

| Config | DocumentRoot | → Port | Status |
|--------|--------------|--------|--------|
| `madladslab-ssl.conf` | /srv/madladslab | 3000 | dir gone, nothing on :3000. Superseded by `000-default-le-ssl.conf` + `madladslab.conf` (which proxy to :3602/slab) |
| `legacy.madladslab.com.conf` (+ `-le-ssl`) | — | 3000 | nothing on :3000 |
| `ws-madladslab-ssl.conf` | — | 3000 | nothing on :3000 |
| `ip-madladslab.conf` | /srv/madladslab | 3000 | dir gone, nothing on :3000 |
| `madThree.conf` (+ `-le-ssl`) | /srv/madThree | 3002 | dir gone, nothing on :3002 |
| `somenewsarticle.conf` (+ `-le-ssl`) | /srv/sna | 3010 | dir in depricated/, nothing on :3010 |
| `theworldwidewallet.conf` (+ `-le-ssl`) | /srv/twww | 3008 | dir in depricated/, nothing on :3008 |
| `ballzinholez.conf` (+ `-le-ssl`) | /srv/bih | 3055 | dir in depricated/, nothing on :3055 |
| `sfg.conf` (+ `-le-ssl`) | /srv/sfg | 3333 | dir in depricated/deletion-stage |
| `mongo-w2marketing.conf` (+ `-le-ssl`) | /srv/w2MongoClient | remote :8012 | dir in depricated/, remote backend likely dead |
| `preview.madladslab.com.conf` (+ `-le-ssl`) | — | 3600 / 3601 | candacewallace + w2marketing paths; neither service is running |
| `000-towers.madladslab.com.conf` (+ `-le-ssl`) | — | — | duplicate of `towers.madladslab.com.conf` (file in sites-enabled is a real file, not a symlink — drift) |

### 2. Vhosts disabled on 2026-05-14 (deprecation cleanup)

Disabled via `a2dissite` after retiring the backing services; configs remain in `sites-available/` for reference but are no longer routed:

- `family-calendar.madladslab.com.conf` + `-le-ssl`
- `on-the-fly.madladslab.com.conf`
- `mediahasher.madladslab.com.conf`
- `acm.conf` + `-le-ssl`

`mobilemeadows.madladslab.com` (+ `-le-ssl`) is left enabled — domain is now a Slab tenant routed to :3602.

### 3. `start-all-services.sh` references missing apps

[start-all-services.sh:18,21](./start-all-services.sh#L18) lists `madladslab` and `nocometalworkz` — both moved to `/srv/depricated/`. The script logs "directory not found" but still proceeds; should be pruned. It is also missing several active services: `game-state-service`, `piper-tts`, `triple-twenty`, `td`.

### 4. `service-watchdog.json` is the old service list

[service-watchdog.json](./service-watchdog.json) references `madladslab`, `bih`, `sna`, `twww`, `w2Marketing`, `madThree`, `nocometalworkz`, `servers` — all retired or idle. Use [auto-start-npm.json](./auto-start-npm.json) as the source of truth; this file should be updated or deleted.

### 5. `.service-monitor/madladslab.down` flag

Left over from the retired `madladslab` app. Safe to delete now that the service is gone.

---

## Adding a New Service — Checklist

1. Create `/srv/<name>/` and pick an unused port (avoid 3000, 3700, and anything in the active table above)
2. Make sure `package.json` has a `start` script that runs production-mode (`node ...`, not `nodemon`)
3. Add to [auto-start-npm.json](./auto-start-npm.json) as `"<name>": "npm start"` (autostart runs `npm start`, not `npm run dev`, to avoid file-watcher overhead in prod)
4. Add to [start-all-services.sh](./start-all-services.sh) `SERVICES` array
5. Apache: drop a **dedicated** vhost conf in `/etc/apache2/sites-available/` (one file per service, never piggyback on slab's wildcard), enable with `a2ensite`, then `certbot --apache -d <domain>`. Security headers are inherited globally — don't redefine them in the vhost.
6. Update this README's Active Services table

---

## Contact / Ownership

- **Operator**: scott@madladslab.com
- **Internal use only** — MadLabs Lab
