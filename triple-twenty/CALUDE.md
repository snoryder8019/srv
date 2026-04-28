# Triple-Twenty — AI-Powered Darts Scoring System
## CLAUDE.md — Architecture Reference

### Stack
- **Runtime**: Node.js + Express + EJS + Socket.IO + MongoDB (Mongoose)
- **Port**: 3710
- **Domain**: triple-twenty.madladslab.com
- **Auth**: Google OAuth2 via passport-google-oauth20
- **AI Backend**: https://ollama.madladslab.com (GPU cluster, dartboard vision model)
- **AI Key**: see .env → OLLAMA_KEY

---

### Views (5 pages)
| Route | File | Purpose |
|-------|------|---------|
| `/` | lobby.ejs | Landing — live active game cards, new game form, join by code |
| `/dashboard` | dashboard.ejs | Game management — host controls, joined games, settings (auth required) |
| `/game/:id` | scoreboard.ejs | TV/display — per-player camera feeds, live scores, dart overlays |
| `/camera/:id` | camera.ejs | Host view — phone/IP cam capture, AI analyze, confirm/correct rounds |
| `/remote/:code` | remote.ejs | Player phone — own camera, AI analysis, manual entry, chat |
| `/leaderboard` | leaderboard.ejs | Rankings, H2H, recent games, ML correction history |

---

### Real-Time Architecture (Socket.IO)

**User rooms**: Every logged-in tab calls `socket.emit('register-user', {userId})` → joins `user:{userId}` room. Turn notifications fire to ALL open tabs/devices for that user simultaneously.

**Game rooms**: Any view joins `game:{gameId}` room. All game events broadcast here.

**Key socket events**:
- `your-turn` → sent to `user:{userId}` room when it's their turn (all devices)
- `game-notification` → sent to `user:{userId}` for game-over, etc.
- `player-analysis` → remote player's board analysis, relayed to host + scoreboard
- `analysis-result` → host's analysis to all game views
- `game-update` → full game state after each confirmed round
- `lobby-frame` → camera frame pushed to landing page live cards
- `lobby-score-update` → score update pushed to landing page cards
- `lobby-update` → triggers landing page to refresh active games list
- `game-archived` → scoreboard/camera redirect to lobby when host ends game

**Single socket per tab**: `window._ttSocket` is the shared instance. All pages (lobby, camera, remote, scoreboard, dashboard) reuse it. `app.js` (global script in foot.ejs) creates it first.

---

### ML Learning Loop
1. Host (or remote player) captures frame → `POST /api/analyze` → Ollama GPU
2. AI returns `{ darts, total, confidence, note }`
3. User confirms or corrects → `POST /api/correct` saves AI vs human result
4. On next analyze call, Ollama injects last 6 corrections as in-context examples
5. Corrections stored in MongoDB `corrections` collection

---

### Game Flow
1. Host creates game at `/` → gets invite code + QR
2. Remote players join at `/remote/{CODE}` on their phones
3. Server auto-claims player slot if logged-in user's displayName matches
4. Host opens `/camera/{id}` — captures frames, AI scores each round
5. Remote players can also capture their own board and submit rounds
6. Each confirmed round: score updated, `your-turn` fires to next player's devices
7. Game finishes → winner notification to all players, game moves to `finished`

---

### Models
- **Game** — hostUserId, players[]{userId, name, token, remaining/marks}, rounds, camera, inviteCode, status, name
- **User** — googleId, displayName, avatar, stats, notifyOnTurn, notifyOnChat
- **Player** — legacy player profile (stats, corrections count)
- **Correction** — gameId, frameId, ai{darts,total}, corrected{darts,total}, note

---

### API Routes
```
GET  /api/health                    — Backend GPU status
GET  /api/active-games              — Active/waiting games for lobby
GET  /api/user/me                   — Dashboard data (auth required)
PATCH /api/user/me                  — Update notification prefs / displayName
POST /api/game                      — Create game
GET  /api/game/:id                  — Get game state
PATCH /api/game/:id                 — Rename/update camera (host only)
DELETE /api/game/:id                — Archive game (host only)
POST /api/game/:id/start            — Start waiting game
POST /api/game/:id/round            — Submit a round (advances turn, fires notifications)
POST /api/game/:id/kick/:idx        — Remove player slot (host only)
POST /api/game/:id/claim            — Link logged-in user to player slot by name
GET  /api/join/:code                — Resolve invite code → game info (auto-claims if logged in)
POST /api/analyze                   — Analyze a base64 frame via Ollama
POST /api/game/:id/capture          — Server-side IP cam capture + analyze
GET  /api/game/:id/snapshot         — Server-side IP cam snapshot
POST /api/proxy-snapshot            — Proxy IP cam snapshot for remote player (CORS bypass)
POST /api/correct                   — Submit AI correction for ML training
GET  /api/corrections               — Get correction history
GET  /api/leaderboard               — Aggregated stats + recent games
GET  /api/h2h/:player1/:player2     — Head-to-head history
```

---

### Camera Sources
- **Host phone**: `getUserMedia({facingMode:'environment'})` → canvas → base64 → `/api/analyze`
- **Host IP cam**: Server fetches `/cgi-bin/snapshot.cgi` via `rtspCapture.js` → `/api/analyze`
- **Remote phone**: Same as host phone but from remote player's device
- **Remote IP cam**: Remote requests `POST /api/proxy-snapshot` (server proxies to avoid CORS)

---

### Notification Flow (cross-device)
```
Round submitted → game.save() → currentPlayerIndex advances
  → _notifyTurn(game, io)
    → io.notifyUser(nextPlayer.userId, 'your-turn', { gameId, gameName, score, link, remoteLink })
      → io.to('user:{userId}').emit('your-turn', ...)
        → EVERY tab/device for that user receives the event
          → Global toast appears (app.js) with Open Game + Remote View buttons
          → Dashboard row highlights with YOUR TURN banner
```
