# Towers (TD) - Architecture Map

**Domain:** `towers.madladslab.com`
**Port:** `3720`
**Tmux session:** `td`

This document is the debugging-first map of the codebase. When something
breaks, identify which compartment it lives in, then fix only that compartment.

---

## Compartmentalization Principle

Every concern has exactly one home. If you find yourself touching three
folders for one feature, the design is wrong - revisit the boundaries.

```
            ┌─────────────────────────┐
            │   views/  (presentation)│   EJS templates - what user sees
            └──────────┬──────────────┘
                       │
            ┌──────────▼──────────────┐
            │   routes/   (page glue) │   Express GET → render(view)
            └──────────┬──────────────┘
                       │
            ┌──────────▼──────────────┐
            │   public/javascripts/   │   Browser code (Three.js + UI)
            │     three/  game/  builder
            └──────────┬──────────────┘
                       │ fetch / socket.io
            ┌──────────▼──────────────┐
            │   api/v1/  (REST)       │   JSON endpoints
            │     routes/ controllers/
            └──────────┬──────────────┘
                       │
            ┌──────────▼──────────────┐
            │   services/ (logic)     │   Pure logic, no Express deps
            │     hex-grid, db, sockets
            └──────────┬──────────────┘
                       │
            ┌──────────▼──────────────┐
            │   api/v1/models/  Mongo │   Schemas only
            └─────────────────────────┘
```

---

## Where Things Live

| Concern                             | Path                                   |
|-------------------------------------|----------------------------------------|
| Boot, middleware wiring             | `app.js`                               |
| All env / paths                     | `config/index.js`                      |
| EJS pages                           | `views/`                               |
| Page route handlers                 | `routes/pages.js`                      |
| REST API                            | `api/v1/routes/`                       |
| Mongo models                        | `api/v1/models/`                       |
| Hex math (server)                   | `services/hex-grid.js`                 |
| Hex math (client - mirror)          | `public/javascripts/three/hex-grid.js` |
| Three.js scene boilerplate          | `public/javascripts/three/scene.js`    |
| Hex board rendering                 | `public/javascripts/three/hex-board.js`|
| Game runtime                        | `public/javascripts/game/`             |
| Builder UIs                         | `public/javascripts/builder/`          |
| Socket.IO handlers                  | `services/socket-handlers.js`          |
| File uploads (GLTF)                 | `api/v1/routes/uploads.js`             |
| Static GLTF                         | `public/assets/gltf/`                  |
| Stylesheets                         | `public/stylesheets/`                  |

---

## Debugging by Symptom

| Symptom                                | Look here                                 |
|----------------------------------------|-------------------------------------------|
| Page won't load                        | `routes/pages.js`, `views/`               |
| API returns 500                        | `api/v1/routes/<resource>.js`             |
| Mongo validation error                 | `api/v1/models/<Model>.js`                |
| Hex positions wrong                    | `services/hex-grid.js` AND mirror file    |
| Three.js scene blank                   | `public/javascripts/three/scene.js`       |
| Tower won't render                     | `public/javascripts/builder/tower-builder.js`, GLTF URL |
| Socket events not arriving             | `services/socket-handlers.js`             |
| Upload rejected                        | `api/v1/routes/uploads.js`, `config.upload`|
| CSS off                                | `public/stylesheets/main.css`             |

---

## Hex Math Sync Rule

`services/hex-grid.js` (Node) and `public/javascripts/three/hex-grid.js`
(browser) must produce identical output for the same axial coords.

When you change one, change both. Tests in `tests/unit/hex-grid.test.js`
should run against both.

---

## Coordinate Systems Quick Reference

- **axial** `{q, r}` - storage, what you save in MongoDB
- **cube** `{x, y, z}` with `x+y+z=0` - rotation/distance math (rare)
- **world** `{x, y, z}` Three.js space - rendering only

Conversion lives in `hex-grid.js`. Never invent your own conversion - import.

---

## Service Lifecycle

```bash
# Start
tmux new-session -d -s td -c /srv/td "PORT=3720 npm start"

# Logs
tmux attach -t td

# Restart only this service
tmux kill-session -t td
tmux new-session -d -s td -c /srv/td "PORT=3720 npm start"

# Health check
curl http://localhost:3720/api/v1/health
```

**Never use `killall node`** - shared VM with sibling services (ps, madladslab, etc.).
