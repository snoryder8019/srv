# OpenClaw — System Context

Static reference for the MadLabs Lab environment. Updated when infrastructure changes.
Last verified: 2026-02-21

---

## Server

| Property | Value |
|----------|-------|
| Provider | Linode |
| OS | Linux 6.14.3-x86_64-linode168 |
| Shell | bash |
| Node version | 18 (do NOT use Node 20+ APIs) |
| Process manager | **tmux** (NOT pm2, NOT systemd) |
| Web server | Apache 2.4.58 (reverse proxy + SSL) |
| SSL | Let's Encrypt (auto-renewing) |
| Apache config | /etc/apache2/sites-available/ |

---

## Services Registry

| Service | Dir | Port | Domain | tmux session | Status |
|---------|-----|------|--------|-------------|--------|
| madladslab | /srv/madladslab | 3000 | madladslab.com | `madladslab` | Active |
| bih | /srv/bih | 3055 | bih.madladslab.com | `bih` | Active dev |
| ps | /srv/ps | 3399 | ps.madladslab.com | `ps_session` | Active |
| game-state | /srv/game-state-service | 3500 | svc.madladslab.com | `game_state_session` | Active |
| servers | /srv/servers | 3600 | servers.madladslab.com | `servers_session` | Active |
| acm | /srv/acm | 3002 | acmcreativeconcepts.com | `acm_session` | Active |
| sfg | /srv/sfg | 3003 | sfg.madladslab.com | `sfg_session` | Degraded (500s) |
| sna | /srv/sna | 3010 | somenewsarticle.com | `sna_session` | Active |
| twww | /srv/twww | 3008 | theworldwidewallet.com | `twww_session` | Active |
| madThree | /srv/madThree | 3001 | three.madladslab.com | `madThree_session` | Active |
| w2MongoClient | /srv/w2MongoClient | 3006 | — | `w2portal` | Active |
| graffiti-tv | /srv/graffiti-tv | 3008 | graffiti.madladslab.com | `graffitiTV` | Active |
| nocometalworkz | /srv/nocometalworkz | 3002 | nocometalworkz.com | `nocometalworkz` | Active |
| mcp-server | /srv/mcp | — | — | `mcp-server` | Active |
| mcp-http | /srv/mcp | 3600 | — | `mcp-http` | Active |

---

## Database

| Property | Value |
|----------|-------|
| Type | MongoDB Atlas |
| Cluster | cluster0.tpmae.mongodb.net |
| Shared DB name | madLadsLab |
| Shared by | madladslab, ps, servers |
| bih DB | separate (configured via bih/.env DB_NAME) |

---

## Auth Stack

| Service | Method |
|---------|--------|
| madladslab | Google OAuth + Facebook OAuth + Local (Passport.js) |
| ps | Shared with madladslab (Passport.js) |
| servers | Google OAuth (admin-only, from madladslab user DB) |
| bih | Google OAuth + Local (Passport.js) |
| sna | Google OAuth + Facebook OAuth + Local |
| Others | None (public) |

Passport config (madladslab): `/srv/madladslab/plugins/passport/passport.js`
Passport config (bih): `/srv/bih/config/passport.js`

Admin check: `user.isAdmin === true` in MongoDB users collection

---

## Key Infrastructure Files

```
/srv/
├── .claude-context.json          # Full service registry (v2.0.0)
├── .claude-module-template.md    # Template for adding new services to context
├── .openclaw/                    # OpenClaw agent memory system
│   ├── IDENTITY.md
│   ├── RULES.md
│   ├── MEMORY.md
│   ├── AGENTS.md
│   └── CONTEXT.md
├── start-all-services.sh         # Start all tmux sessions
├── service-control.sh            # Individual service control
├── monitor-services.sh           # Service health monitor
├── QUICK_START.md                # Onboarding reference
└── README.md                     # Service directory
```

---

## Common tmux Commands

```bash
# List all running sessions
tmux ls

# Attach to a session
tmux attach -t <session-name>

# Detach (inside tmux)
Ctrl+b, then d

# Send Ctrl+C to a session
tmux send-keys -t <session-name> C-c

# Kill a session
tmux kill-session -t <session-name>

# Start new session
tmux new-session -d -s <name> -c /srv/<dir> 'PORT=<port> npm start'

# Capture recent log output
tmux capture-pane -t <session-name> -p | tail -30
```

---

## BIH Service Quick Ref

```bash
# Start (already has session)
tmux send-keys -t bih "npx nodemon app.js" Enter

# Restart
tmux send-keys -t bih C-c && sleep 2 && tmux send-keys -t bih "npx nodemon app.js" Enter

# View logs
tmux attach -t bih

# Check port
lsof -i :3055
```

Key files:
- Entry: `/srv/bih/app.js`
- Auth: `/srv/bih/config/passport.js`, `/srv/bih/routes/auth.js` (GET/POST)
- Models: `/srv/bih/models/User.js`, `/srv/bih/models/Ticket.js`, `/srv/bih/models/Channel.js`
- Routes: `/srv/bih/routes/` (index, auth, profile, api, tickets)
- Socket: namespace `/chat` in app.js
- WebRTC: `/srv/bih/public/js/webrtc.js`, `/srv/bih/public/js/broadcast.js`

---

## MadLabs Lab Quick Ref

```bash
# Restart
tmux send-keys -t madladslab C-c && tmux send-keys -t madladslab "PORT=3000 npm start" Enter
```

Key files:
- Entry: `/srv/madladslab/bin/www`
- Back office: `/srv/madladslab/routes/backOffice/`
- StevenClawbert: `/srv/madladslab/routes/stevenClawbert/`
- Finances: `/srv/madladslab/routes/finances/`
- Models: `/srv/madladslab/api/v1/models/`
- Auth: `/srv/madladslab/plugins/passport/passport.js`

---

## Email / External Services

| Service | Purpose |
|---------|---------|
| Zoho | Transactional email (alerts, notifications) |
| Linode Object Storage | Avatar uploads (bucket: `madladslab`) |
| Twitch API | Live stream lookup for bih users |
| NewsAPI.org | Fallback headlines for sna |
| Google OAuth | Auth across madladslab, bih, ps, servers |
| Facebook OAuth | Auth for madladslab, sna |
