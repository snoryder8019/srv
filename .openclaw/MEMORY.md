# OpenClaw — Memory

This is the living memory document. Updated at the end of significant sessions.
Format: most recent entries at top. Timestamp: YYYY-MM-DD.

---

## Current State (2026-02-21)

### Active Projects

| Project | Status | tmux session | Port | Notes |
|---------|--------|-------------|------|-------|
| `bih` | Active dev | `bih` | 3055 | Gaming community hub — see below |
| `madladslab` | Active dev | `madladslab` | 3000 | Main lab platform |
| `ps` | Active | `ps_session` | 3399 | Project Stringborne sci-fi MMO |
| `sna` | Running | `sna_session` | 3010 | News aggregation |
| `twww` | Running | `twww_session` | 3008 | Payment directory |
| `acm` | Running | `acm_session` | 3002 | ACM Creative |
| `graffiti-tv` | Running | `graffitiTV` | 3008 | Visual platform |
| `servers` | Running | `servers_session` | 3600 | Admin monitoring |
| `game-state` | Running | `game_state_session` | 3500 | Stringborne state svc |
| `w2MongoClient` | Running | `w2portal` | 3006 | MongoDB client |
| `mcp` | Running | `mcp-server` / `mcp-http` | N/A / 3600 | Claude MCP |
| `nocometalworkz` | Running | `nocometalworkz` | 3002 | Business site |

---

### BIH Project — Current State (2026-02-21)

**What it is:** Gaming community hub — auth, chat, WebRTC, Twitch integration, tickets

**Stack:**
- Express + EJS, port 3055, tmux `bih`
- MongoDB Atlas (separate DB from madladslab)
- Passport.js (Google OAuth + local)
- Socket.IO `/chat` namespace (authenticated)
- WebRTC (1-on-1 voice/video/screen + broadcast)
- Linode Object Storage for avatars

**Completed phases:**
- Phase 1: Auth (local + Google OAuth), User model, dashboard
- Phase 2: Real-time chat (Socket.IO), link previews (OG scraper), online users
- Phase 3: WebRTC 1-on-1 calls (voice/video/screen share)
- Phase 4: Broadcast (admin/bih-role → one-to-many live streaming)
- Phase 5: Ticket system (CRUD, staff actions, status management)
- Profile: name, avatar (S3), Epic Games ID, Twitch ID

**In progress / Recent:**
- Twitch integration: `lib/twitch.js`, GET /api/twitch/live
- Channel model: `models/Channel.js`
- Channels routes/views: `routes/channels.js`, `public/js/channels.js`
- Ticket system: `routes/tickets.js`, `views/tickets/`

**Restart command:**
```bash
tmux send-keys -t bih C-c && tmux send-keys -t bih "npx nodemon app.js" Enter
```

---

### MadLads Lab — Recent Changes (2026-02-21)

**StevenClawbert** — chat thread system in madladslab:
- Routes: `/srv/madladslab/routes/stevenClawbert/`
- Views: `/srv/madladslab/views/stevenClawbert/`
- Admin nav updated: `/srv/madladslab/views/mainContent/adminNav.ejs`

**Finances module** — new feature:
- `/srv/madladslab/routes/finances/`
- `/srv/madladslab/views/finances/`
- `/srv/madladslab/finances.md`

**File browser (StevenClawbert):**
- `/srv/madladslab/routes/stevenClawbert/filebrowser.js`
- `/srv/madladslab/views/stevenClawbert/filebrowser.ejs`

---

### Project Stringborne — Recent Changes

- v0.8.10: World Sprite Builder — Contextual Category System
- v0.8.9: World Sprite Builder — Expanded Pack Types for 2D Environments

---

## Key Architectural Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-21 | Created `.openclaw/` system | Persistent AI memory + identity across sessions |
| 2025-11-08 | tmux-only process management (no PM2) | All services isolated in named tmux sessions |
| 2025-11-08 | MCP server at /srv/mcp | Claude API integration bridge |
| 2025-10-22 | Shared MongoDB (madLadsLab) across madladslab/ps/servers | Single Atlas cluster, separate collections |
| 2025-10-22 | Apache proxy + Let's Encrypt for all services | Unified SSL termination via reverse proxy |

---

## User Preferences

- No emoji in responses unless requested
- Short, direct responses
- File references as markdown links
- Ask before destructive actions
- tmux for all service management
- Confirm before any git push
- Dev stack preference: Node.js/Express/MongoDB/EJS

---

## Known Gotchas

- `connect-mongo` is v5 — do NOT upgrade to v6 (requires Node 20, VM is Node 18)
- Mongoose 9 async hooks: no `next` parameter — just return/throw
- `sfg` service returns 500 errors — marked degraded, do not rely on it
- Port 3008 conflict: `twww` and `graffiti-tv` both listed at 3008 — verify actual assignment
- `bih` uses `http.createServer(app) + server.listen()` not `app.listen()` (Socket.IO requirement)
- MongoDB connection: `DB_URL + DB_NAME` pattern in bih (not hardcoded full URI)

---

## Session Log

| Date | Session ID | What happened |
|------|-----------|---------------|
| 2026-02-21 | 623ab065 | Created .openclaw system (IDENTITY, RULES, MEMORY, AGENTS, CONTEXT) |
| 2026-02-21 | 38d1a854 | StevenClawbert chat threads + file browser in madladslab |
| 2026-02-20 | d1ff1f53 | madladslab work (StevenClawbert, finances module) |
| 2026-02-17 | 4c5dcc38 | Large session — multiple services |
| 2026-02-17 | 0e3febc3 | Large session — multiple services |
| 2026-02-16 | 12ecd55f | Session work |
| 2026-02-12 | b455c987 | Large session |
| 2026-02-10 | a6ce0343 | Large session |
