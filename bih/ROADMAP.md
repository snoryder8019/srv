# bih — Roadmap

## Phase 1: Foundation (Complete)
- [x] Express + EJS setup on port 3055
- [x] MongoDB Atlas integration (mongoose)
- [x] Passport authentication (Google OAuth + local email/password)
- [x] Session management with connect-mongo store
- [x] Nodemon dev workflow + tmux session

## Phase 2: Real-Time Chat (Complete)
- [x] Socket.IO integration with session sharing
- [x] Authenticated `/chat` namespace — only users with active sessions
- [x] Hover chat widget (floating bubble, expandable panel)
- [x] Online user presence tracking (deduplicated by userId)
- [x] Unread message badge
- [x] Chat history persistence (20 messages + load more on scroll)
- [x] Sidebar user list with avatars (@media responsive for mobile)
- [x] Web Audio connect ping + message blip sounds
- [x] Aggressive reconnect (300ms delay, infinite attempts, visibilitychange)
- [x] User avatars in chat messages (circular, with letter placeholder fallback)
- [x] Fresh avatar/displayName on every message (re-fetches from DB)
- [x] URL detection — clickable links in chat messages
- [x] Link previews — OG metadata cards with thumbnail, title, description (custom cheerio scraper)

## Phase 2.5: User Profiles (Complete)
- [x] Profile page with display name update
- [x] Avatar upload to Linode Object Storage (S3-compatible, BIH/ directory)
- [x] Avatars displayed in sidebar, chat messages, and dashboard

## Phase 3: WebRTC — Voice & Video (Complete)
- [x] Peer-to-peer voice chat via WebRTC
- [x] Camera/video chat with WebRTC
- [x] Screen sharing support
- [x] Signaling server via Socket.IO (offer/answer/ICE candidates)
- [x] STUN/TURN server configuration (Google STUN; TURN placeholder ready)
- [x] Media device selection (mic, camera, screen)
- [x] Call UI — ring, accept, reject, hang up
- [x] Multi-party calls (full-mesh topology, room-based signaling, dynamic peer grid, join-call UX)

## Phase 3.5: Ticket System (Complete)
- [x] Ticket model (subject, message, status, staff actions)
- [x] User role fields (isAdmin, isBIH) on User schema
- [x] Submit ticket form for all authenticated users
- [x] Ticket list — users see own tickets, staff (isAdmin/isBIH) see all
- [x] Ticket detail view with action history
- [x] Staff panel — add responses, update status (open/in-progress/closed)

## Phase 4: Communication Enhancements (Future)
- [ ] Direct messages (1-on-1 private chat)
- [ ] Chat rooms / channels
- [ ] Typing indicators
- [ ] Read receipts
- [ ] File/image sharing in chat
- [ ] Push notifications

## Phase 5: Platform Growth (Future)
- [ ] Epic / Twitch username fields on profile
- [ ] Admin panel / user management (role fields added — isAdmin, isBIH)
- [x] Role-based access control (ticket system uses isAdmin/isBIH)
- [ ] Activity/presence status (online, away, busy)
- [ ] Mobile-responsive UI polish
