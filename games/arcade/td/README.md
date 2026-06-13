# Towers (TD)

A community-built hex tower defense. Inventors design GLTF towers and hex
maps; the platform handles physics, voting, and live multiplayer.

**Domain:** `towers.madladslab.com`
**Port:** `3720`
**Status:** v0.1.0 - boilerplate

---

## Quick Start

```bash
cd /srv/td
cp .env.example .env       # adjust DB_URL if needed
npm install
npm start                  # listens on PORT=3720
```

Visit `http://localhost:3720` - or `https://towers.madladslab.com` once
nginx is pointed at port 3720.

### Health check

```bash
curl http://localhost:3720/api/v1/health
```

---

## What's in v0.1.0

- ✅ Express + EJS + Socket.IO + Mongoose stack
- ✅ Hex grid math (server + client mirror, axial coords)
- ✅ Three.js scene with reusable hex board renderer
- ✅ Tower model + REST API + voting stub
- ✅ Map model + REST API + on-the-fly hex generation
- ✅ Run model + leaderboard endpoint
- ✅ GLTF upload endpoint with size + ext validation
- ✅ Tower builder UI (upload GLTF → preview on hex → save)
- ✅ Map builder UI (paint spawn/base/path/blocked → save)
- ✅ Play view (loads demo map, renders board)
- ✅ Browse community page
- ⏳ Wave system, pathfinding, tower targeting (next)
- ⏳ Auth + per-user submissions (next)
- ⏳ Voting/moderation flow (next)

---

## Directory Layout

See `docs/architecture/OVERVIEW.md` for the full debugging-first map.

```
/srv/td
├── app.js              # boot
├── config/             # env + paths
├── api/v1/             # REST API
│   ├── models/         # Mongoose schemas
│   ├── routes/         # endpoint handlers
│   ├── controllers/    # (reserved for fat handlers)
│   └── middleware/     # (reserved for auth, validation)
├── routes/             # EJS page routes
├── services/           # pure logic (hex math, sockets, db)
├── views/              # EJS templates
│   ├── partials/
│   ├── game/
│   ├── builder/
│   └── admin/
├── public/
│   ├── javascripts/
│   │   ├── three/      # shared Three.js modules
│   │   ├── game/       # gameplay client code
│   │   └── builder/    # builder UI client code
│   ├── stylesheets/
│   └── assets/         # gltf / textures / sprites
├── docs/               # architecture, patch notes
├── scripts/            # CLI utilities
├── tests/              # unit + integration
├── plugins/            # cron, integrations
└── middlewares/        # express middleware
```

---

## Design Principles

1. **One concern per folder.** If a feature spans 3+ folders, the boundary is wrong.
2. **Server is authoritative.** Game state lives in Mongo + memory; clients render.
3. **Hex math is sacred.** Two copies (server + client) must agree. Always.
4. **Schema-first.** Every entity has a Mongoose schema before it has a UI.
5. **Low-code surface = forms + Blockly later.** Builders today = forms; behavior nodes next.

---

## Adding a New Entity

1. Define schema in `api/v1/models/Foo.js`
2. Add routes in `api/v1/routes/foos.js`, mount in `api/v1/index.js`
3. Add EJS view in `views/builder/foo.ejs`
4. Add page route in `routes/pages.js`
5. Add client builder in `public/javascripts/builder/foo-builder.js`

---

## Service Management

```bash
tmux new-session -d -s td -c /srv/td "PORT=3720 npm start"
tmux attach -t td             # logs
tmux kill-session -t td       # stop
```

**Never `killall node`.** This VM hosts other services (ps, madladslab, etc.).
