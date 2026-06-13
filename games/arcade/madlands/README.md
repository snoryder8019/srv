# Madlands — build baseline

Recursive hex adventure. Aesthetic: **viking · space · funk · metal · pop**.
World nests by scale: **space → body → zone → interior** (dungeon/building/ship).
Built backward from the towers (`/srv/td`) render core.

- URL: https://madlands.madladslab.com  ·  port **3730**  ·  tmux session **madlands**
- Stack: Express + EJS + Mongo (db `madlands`) + platform SSO (games.madladslab.com)
- Run: `cd /srv/madlands && node app.js` (registered in `/srv/start-all-services.sh` + `service-watchdog.json`)
- Restart (in place): `tmux respawn-pane -k -t madlands "cd /srv/madlands && node app.js 2>&1 | tee -a logs/madlands.log"`

## What works (testable now)
- **Auth/SSO**: `/auth/platform` → games bridge → session. Admin gated on `canAdmin`
  (global `isAdmin` OR `permissions.games==='admin'` OR `permissions.madlands==='admin'`).
  Sessions persist in Mongo. Dev login (non-prod): `/auth/dev`.
- **Map** (`/`): reused camera + hex board; scale ladder (Descend/Ascend); built hexes
  are marked; descending into a hex applies its SD sky/ground + palette, places its
  objects (movable ones animate), and plays its music cue (Tone.js).
- **Admin builder** (`/admin`, canAdmin only):
  - 6 focused agents (registry: `services/agents/index.js`): environment, object, npc,
    level, storyline, music. Each: type notes → **Run agent** fills the form → edit → **Save**.
  - **Guardrails** (`services/agents/validate.js`): warnings inline; hard errors block save
    (bad hexKey format, unplayable chords, invalid palette, etc).
  - environment has **Generate art (SD)**; music has **▶ Preview** (Tone.js).
  - **Director** (`services/agents/director.js`): focus line + per-hex **completion board**
    + actionable **tasks** (links prefill the right builder for the right hex).
  - **Builds manager** (`/admin/builds`): status workflow (draft/ready/published) + delete.
- **Public world API**: `GET /api/world`, `GET /api/hex/:hexKey`.

## Data model
`Build` (`models/Build.js`): `{ kind, tier, hexKey, name, input, output, agent, status, createdBy }`.
A hex's content = all Builds with that `hexKey`. Identity fields (`hexKey`, `tier`) are
operator-owned and never agent-filled.

## Not built yet (next layers)
- Master-compose (assemble a hex's builds into one coherent board on Descend).
- Per-tier persistence (each child board saved as its own map).
- NPC/level visualized on the board (only environment + objects + music render today).
- Real GLTF objects (currently primitives; `gltfPrompt` stored for later).
- Runtime/play loop → then the platform **score handoff** (copy `td/services/platform/report.js`).

## AI gateway
Shared GPU tunnel (`OLLAMA_URL`, OpenAI-compatible): `/v1/chat/completions` (qwen2.5:7b)
for agents, `/v1/images/generations` (SD) for art. No audio model — music is synthesized
client-side from the agent's score via Tone.js (`public/javascripts/madlands/music-engine.js`).
