RULES FOR CLAUDE

NEVER KILL ALL NODE...this vm has tmux and many session running webapps. tmux into the app and restart there.

## Project: bih
- Express app running on port 3055
- tmux session: `bih` (restart with: `tmux send-keys -t bih C-c && tmux send-keys -t bih "npx nodemon app.js" Enter`)
- Uses nodemon for auto-restart on file changes
- See ROADMAP.md for full project roadmap

## Stack
- Express + EJS views
- MongoDB Atlas (mongoose) — connection built from DB_URL + DB_NAME in .env
- Passport.js authentication (Google OAuth + local email/password)
- express-session with connect-mongo session store
- bcrypt for password hashing
- Socket.IO for real-time chat (authenticated `/chat` namespace)
- WebRTC for 1-on-1 voice, video, and screen sharing (Phase 3 complete)

## .env Namespaces
- PORT — app port (3055)
- DB_URL — MongoDB Atlas connection string (mongodb+srv://...)
- DB_NAME — database name
- MON_USER / MON_PASS — mongo credentials (referenced in DB_URL)
- SESSION_SECRET — session signing key
- GOOGLE_CLIENT_ID — Google OAuth client ID
- GOOGLE_CLIENT_SECRET — Google OAuth client secret
- GOOGLE_CALLBACK_URL — Google OAuth redirect URI
- LINODE_ACCESS — Linode Object Storage access key
- LINODE_SECRET — Linode Object Storage secret key
- S3_LOCATION / LINODE_BUCKET — bucket name (`madladslab`)

## Structure
```
bih/
├── app.js                  # Entry point (express + socket.io server)
├── config/
│   └── passport.js         # Local + Google strategies
├── models/
│   └── User.js             # User schema (email/pass, googleId, avatar)
├── routes/
│   ├── index.js            # Home + dashboard (auth-gated)
│   └── auth.js             # Login, register, Google OAuth, logout
├── views/
│   ├── partials/
│   │   ├── chat.ejs        # Hover chat widget partial
│   │   ├── sidebar.ejs     # Online user list + call buttons
│   │   └── call.ejs        # WebRTC call overlay + incoming modal
│   ├── home.ejs
│   ├── login.ejs
│   ├── register.ejs
│   └── dashboard.ejs
├── public/
│   ├── css/
│   │   ├── chat.css        # Chat widget styles
│   │   ├── sidebar.css     # Sidebar styles
│   │   └── call.css        # Call overlay styles
│   └── js/
│       ├── chat.js         # Chat client (socket.io)
│       └── webrtc.js       # WebRTC client (voice/video/screen)
├── .env                    # DO NOT commit
├── .gitignore
├── .nodemonignore
└── ROADMAP.md
```

## Auth Routes
- GET /auth/login — login page
- POST /auth/login — local login
- GET /auth/register — register page
- POST /auth/register — create local account
- GET /auth/google/init — starts Google OAuth flow
- GET /auth/google — Google OAuth callback (matches GOOGLE_CALLBACK_URL)
- GET /auth/logout — logout
- GET /dashboard — protected, requires authentication

## Socket.IO
- Namespace: `/chat` — only accessible to users with an active passport session
- Session sharing: express-session middleware is shared with socket.io via `io.engine.use()`
- Chat events: `chat-message` (broadcast), `online-users` (presence), `link-preview`
- WebRTC signaling events: `call-request`, `call-accept`, `call-reject`, `call-hangup`, `webrtc-offer`, `webrtc-answer`, `webrtc-ice`, `call-toggle-media`
- Hover chat widget appears on all pages for authenticated users (via partials/chat.ejs)
- Online user tracking via in-memory Map (keyed by socket.id)
- Active call tracking via in-memory Map (keyed by callId)

## Precautions
- NEVER run `killall node` or `pkill node` — other apps share this VM
- NEVER commit .env — contains secrets and is in .gitignore
- Mongoose 9 async pre-hooks do NOT use `next` — just return or throw
- Google callback URL in .env must exactly match Google Console redirect URI
- connect-mongo v5 is used (v6 requires Node 20+, VM runs Node 18)
- app.js uses `http.createServer(app)` + `server.listen()` (NOT `app.listen()`) for Socket.IO
