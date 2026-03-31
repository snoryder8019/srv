# MadLadsLab Games Platform — Roadmap

## Subscription Tiers
- **$2/mo — Play**: Access to join any public game server, chat, broadcasts
- **$12/mo — Private Server**: Spin up 1 private dedicated server at a time. Cold-save worlds between sessions. Swap games on the same box
- **$30/mo — Multi-Server**: Up to 3 private servers running simultaneously. Priority provisioning
- **$80 — Lifetime Play**: Permanent $2/mo tier, never expires
- **$100/mo — Premium**: Custom server-cam broadcasting on your server (GPU-rendered 3D spectator cam), priority support, broadcaster permissions where allowed

## Completed (v0.9)
- Express portal with auth (local + Google OAuth), admin panel, unified terminal
- 4 game servers: Rust (Carbon), Valheim (BepInEx), L4D2 (SourceMod), 7DTD
- Live broadcast system with SFU/WebRTC, voice chat, screen share
- Linode auto-provisioning pipeline for overflow servers
- Sandboxed game users (gs-rust, gs-valheim, gs-l4d2, gs-7dtd) — process isolation
- Real-time stats collector, log streamer, playtime tracking, world backups
- Plugin management UI with config editor
- Server-cam system: Rust 2D map overlay (live RCON positions on real map), 7DTD web dashboard, L4D2 SourceTV with auto-director
- Security hardened: redirect validation, secure cookies, CORS lockdown, XSS fixes, SFU auth, privilege escalation prevention
- Version system with auto-bump cron + patch notes

## Next Up
1. **Stripe Billing Integration** — charge for tiers, auto-set subscription on user doc, gate server provisioning behind tier checks
2. **"My Server" Dashboard** — $12/mo+ users get a self-service panel: pick game, spin up Linode, cold-save/restore worlds, swap games
3. **Broadcaster Play Button** — users with broadcaster role hit Play, auto-creates broadcast room, appears on landing page live section
4. **Three.js Stats Globe** — 3D visualization on landing page: live player activity, kill events as particle bursts, server status as glowing nodes, all piped via Socket.IO
5. **Carbon Spectator Bot** — Rust plugin: invisible admin camera that auto-follows the most active player, flies to raid/kill events, patrols cinematic paths when idle
6. **GPU Cam Service** — for $100/mo Premium tier: spin up a cloud GPU instance on-demand, run game client in spectator mode, pipe 3D footage to SFU as a live broadcast
7. **L4D2 Software Render Experiment** — try running a Source client with Mesa llvmpipe on the Linode to pipe SourceTV into SFU at low res. Zero-cost autonomous broadcast if it works
8. **Multi-Server Management** — $30/mo tier: dashboard to manage up to 3 simultaneous private servers, resource monitoring, one-click swap between cold-saved worlds
