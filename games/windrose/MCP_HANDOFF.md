# Windrose MCP — Handoff for the mod-builder Claude

> 🤝 **2026-05-22 — scott-claude has opened an agent-to-agent channel.**
> Before doing anything else, read [windrose-build/AGENT-CHAT.md](../public/windrose-build/AGENT-CHAT.md)
> and append a reply at the bottom. Scott has asked us to coordinate directly
> rather than relay through him. Append-only convention; details in the file.

You're Claude Code with the **windrose** MCP connected. That MCP gives you a
scoped view of a live UE5 game server (Windrose / Apex Legends: Titanfall
"R5") running on a Linode at `games.madladslab.com`. Your job is to help the
human you're paired with build mods for it — Lua scripts that load via UE4SS,
plus **two** sandboxed UI overlays on the public game-portal page:

- **Map** overlay (public): the player-facing world-map / mod-map UI. Every
  signed-in visitor to games.madladslab.com sees this when they open the
  Windrose card's **Map** tab. Lives at `/srv/games/public/windrose-map/`.
- **Build** overlay (admin-only): a dev/control surface visible only to the
  admin. Lives at `/srv/games/public/windrose-build/`. Use this for
  authoring tools, debug panels, mod-iteration UI — anything you want the
  admin to see but not the public.

This file is the source of truth for what you can do and how. **Read it first.**

---

## 1. What you control

### Read scope (any path that resolves under one of these)
- `/srv/games/windrose/` — server files, configs, logs, runtime state
- `/srv/games/public/windrose-build/` — sandboxed admin overlay (see §5)
- `/srv/games/public/windrose-map/` — sandboxed public overlay (see §5)

### Write scope
- `/srv/games/windrose/R5/Binaries/Win64/ue4ss/Mods/` — Lua mod source
- `/srv/games/public/windrose-build/` — admin (Build tab) overlay
- `/srv/games/public/windrose-map/` — public (Map tab) overlay
- The single file `/srv/games/windrose/windrose_plus.json` — server config
- The single file `/srv/games/windrose/R5/Binaries/Win64/ue4ss/Mods/mods.txt`
  — which mods UE4SS loads at boot

Anything else is rejected by the MCP with `path not in scope: <p>`. Don't
treat scope errors as a bug to work around — they mean you tried to touch
something outside what the admin agreed to expose. Tell the human and let
them decide.

---

## 2. The stack you're modding

- **Game**: Windrose (UE5.6 pirate-themed survival) running as a Windows
  dedicated server under **Proton-GE 10-34** on Linux (Wine 9 has a known
  gRPC IOCP crash, so don't suggest it).
- **Mod loader**: **UE4SS** (experimental-latest, since stable 3.0.1 lacks
  UE 5.6 signatures). Loaded via a `dwmapi.dll` proxy at
  `R5/Binaries/Win64/`. UE4SS reads `Mods/mods.txt` on boot to decide which
  mods to load. Order matters.
- **Framework mod**: **WindrosePlus 1.0.16** (MIT,
  github.com/humangenome/WindrosePlus). Lua, server-side. Provides live map,
  server query, an NDJSON activity log, and admin commands. **No SteamID is
  exposed** — players are keyed by name. RCON is gated behind a password in
  `windrose_plus.json` that defaults to disabled.
- **Discovery mod**: **MadLadsStats** at `Mods/MadLadsStats/`. Currently
  disabled (mods.txt = 0). Was used to enumerate the player character
  blueprint class
  (`/Game/Gameplay/Character/BP_R5Character.BP_R5Character_C`) and probe
  death/damage `UFunction` hooks. **Most engine-level hooks didn't fire
  during testing** — `RegisterHook` is unreliable for engine functions in
  this Proton/UE5.6 build. `ServerSaveMoveInput` did fire reliably. If you
  need death detection, the working approach is **position-jump detection
  via ServerSaveMoveInput**, not a death hook.
- **WindrosePlus events that DO fire**: `mod.boot`, `config.load`,
  `config.load.fail`, `heartbeat`, `player.join`, `player.leave`,
  `admin.command`. Mapped into the host's MongoDB as `game_events` rows with
  type `player_join`, `player_leave`, `heartbeat`, `command`.
- **WindrosePlus events that DO NOT fire** (gated on upstream or a custom
  companion Lua mod): damage, kills, chat, piece placement, ship sinks, item
  drops. Do not invent these — they aren't in the event stream.
- **`player.join` is set-diff, not lifecycle**. It fires when a name appears
  in the active list. Death + respawn keeps the same name → no `player.join`
  fires. Network reconnects DO fire a `player.join`. Do not synthesize
  deaths from "join without preceding leave."

---

## 3. Your tools (quick reference)

The full schemas are in `tools/list` — call that first if you want exact
arg shapes. The shorthand:

| Tool | What it does | Notes |
|---|---|---|
| `fs_list({path})` | List a directory | Returns file/dir names + sizes |
| `fs_read({path})` | Read a UTF-8 text file | 2 MB cap |
| `fs_write({path, content})` | Create/overwrite a text file | Creates parent dirs, 2 MB cap |
| `fs_delete({path})` | Delete one file | Refuses directories |
| `fs_mkdir({path})` | Create a dir (recursive) | |
| `list_mods()` | Parse `mods.txt` + scan `Mods/` | Surfaces "on disk but not declared" |
| `set_mod_enabled({name, enabled})` | Toggle a line in `mods.txt` | Adds the line if it's missing |
| `tail_log({name, lines})` | Tail a log | `name` = `ue4ss` \| `r5` \| `server` |
| `get_server_status()` | `windrose_plus_data/server_status.json` | Live snapshot |
| `get_livemap()` | Live player/mob positions | |
| `get_pois()` | POI scan from MadLadsStats | Big file, but you'll want it |
| `get_world_census()` | Class census from MadLadsStats | Top BP classes + counts |
| `get_events({types?, since?, limit?})` | Query MongoDB `game_events` | Caps at 200 rows |
| `get_players({limit?})` | `player_stats` rows | Name-keyed; no SteamID |
| `read_plus_config()` | `/srv/games/windrose/windrose_plus.json` | |
| `write_plus_config({config})` | Overwrite that file | You must send the FULL object — no server-side merge |

There's a parallel `resources/list` you can use if you prefer
resources/read over tool calls — same data, simpler interface for some
clients.

---

## 4. Workflows that actually work

### "What mods are loaded and what's actually firing?"
```
list_mods()                  // see declared mods + on-disk orphans
tail_log({name:"ue4ss"})     // see the UE4SS injection chain + which mods initialised
get_events({types:["mod_boot","heartbeat"], limit:5})
```

### "Iterate on a Lua mod"
```
fs_list({path:".../ue4ss/Mods/MyMod/Scripts"})
fs_read({path:".../Scripts/main.lua"})
fs_write({path:".../Scripts/main.lua", content:"<new lua>"})
```
**Heads-up**: UE4SS does not hot-reload mods. After a write, you have to
ask the admin to restart the Windrose server (the human you're paired with
can do this — you cannot). Plan your iterations: get the logic right in
one batch of writes, not file-save-test loops.

### "Check if WindrosePlus picked up a config change"
```
write_plus_config({...})                            // overwrite
get_events({types:["config.load","config.load.fail"], limit:3})
```
On the next config.load event the file is live. config.load.fail tells
you you wrote bad JSON or hit a schema problem WindrosePlus rejects.

### "What classes/actors are in the world right now?"
```
get_world_census()           // top classes + counts (mobs, ships, bosses, farming plots)
get_pois()                   // POI positions + island grouping
get_livemap()                // live player/mob positions for the current session
```

### "Build out the public Map / mod-map"
This is usually what the human means by "the mod map." Edit the three
files under `/srv/games/public/windrose-map/`. The Map tab fetches them
with a cache-buster on every open, so every signed-in visitor sees your
work the next time they open the tab. No server restart.

### "Make a change to the admin Build tab UI"
Same convention but in `/srv/games/public/windrose-build/`. Only the
admin sees the Build tab — use this for dev tooling and debug surfaces.

---

## 5. The UI overlay convention

Both overlays share the same three-file shape. Pick the right namespace
based on who should see your work:

| Surface | Dir | Tab on Windrose card | Audience |
|---|---|---|---|
| **Map** (public) | `/srv/games/public/windrose-map/` | Map | every signed-in player |
| **Build** (admin) | `/srv/games/public/windrose-build/` | Build | the admin only |

Each dir holds:
- `extension.html` — injected into the tab's slot div
- `extension.css` — loaded as a stylesheet
- `extension.js` — loaded as a script, expected to set the right global

### Map overlay (public)
- Slot div: `<div id="windrose_map_ext_slot">`
- Script global: `window.windroseMapExt.boot(ctx)`
- Class/ID prefixes: `.wrme-` / `wrme_`
- `ctx` is `{ panel, state, api }`:
  - `panel` — the slot `HTMLElement`
  - `state` — first `/windrose-map/api/state` payload, pre-fetched
    (`serverStatus`, `livemap`, `pois` summary) so the initial render is
    a single round trip
  - `api(method, path, body?)` — `fetch` helper with the session cookie

### Build overlay (admin)
- Slot div: `<div id="windrose_build_ext_slot">`
- Script global: `window.windroseBuildExt.boot(ctx)`
- Class/ID prefixes: `.wrbe-` / `wrbe_`
- `ctx` is `{ panel, api }` — same `api` helper, hits `/mcp/windrose/*`
  (admin-only endpoints) with the session cookie

### Rules of the road for both
- Use the right class/ID prefix to stay out of the host page's namespace.
- The host page reloads these files with `?cb=<timestamp>` every time the
  tab is opened, so just re-opening the tab is enough to see your edit.
- **Do not modify `/srv/games/public/index.html`.** You can't — it's
  outside the write scope. The overlay slot is the only legitimate way to
  change the tab's content.
- For live data, public overlays use `/windrose-map/api/state` and
  `/windrose-map/api/pois` (session-cookie auth). Admin overlays can
  additionally hit `/mcp/windrose/status` (also session-cookie auth,
  admin-only).

A good overlay is opinionated and self-contained — show the player
something they couldn't piece together themselves from the raw data.

---

## 6. Things you can't do (don't try)

- **Restart the game server.** That's the human's job. You don't have a
  `restart_server` tool, and you don't have shell access.
- **Send RCON.** WindrosePlus exposes an RCON bridge but the MCP doesn't
  wrap it yet. If the human asks, tell them and offer to add the tool —
  it'd live in `lib/windrose-mcp.js`.
- **Read steam IDs.** WindrosePlus doesn't surface them. Player rows are
  keyed by name. Two players with the same name are indistinguishable;
  don't try to disambiguate them.
- **Touch any non-Windrose game server, the games portal app, or anything
  on the host.** Your scope ends at the Windrose paths.

---

## 7. Etiquette

- Read before you write. Always `fs_read` an existing mod (or
  `tool list_mods` then explore) before authoring against it — the local
  conventions (config layout, log lines, class naming) matter.
- Prefer additions over rewrites. The human's existing mods like
  `WindrosePlus` and `MadLadsStats` are working surfaces — extend them or
  add a new mod dir next to them rather than rewriting them.
- When you're unsure whether something fires, **check the log + event
  stream first** instead of guessing. `tail_log` and `get_events` are
  cheap and accurate.
- When you finish an edit, tell the human exactly what they need to do to
  see the change: nothing (overlay), restart server (Lua), or nothing
  (config — picks up on next config.load).

---

## 8. Transport, troubleshooting, and connection insight

The server speaks **two MCP transports** at different URLs. Pick the one
your client supports — if you don't know which, try Streamable HTTP first.

| Transport | Client URL | When to use |
|---|---|---|
| **Streamable HTTP** (modern, 2025+) | `POST https://games.madladslab.com/mcp/windrose` | Recent Claude Code `claude mcp add --transport http`. Synchronous JSON responses. |
| **Legacy SSE** (2024-11-05) | `GET https://games.madladslab.com/mcp/windrose/sse` | Claude Desktop and older Claude Code. The GET returns an SSE stream whose first event is `endpoint`; you POST messages to the URL in `endpoint.data` and read responses back through the open SSE stream. |

If your client times out **after** the initial connection (you see TLS
complete and the GET land server-side but never get a response), you're
almost certainly on the wrong transport. Symptoms:
- **Legacy client on Streamable HTTP URL**: client opens GET to `/mcp/windrose`,
  expects an `endpoint` event, never gets one → timeout. Fix: use `/sse`.
- **Modern client on Legacy URL**: rarer. Client expects synchronous JSON
  from POST. Fix: use bare `/mcp/windrose`.

### Pre-flight checks before reporting "it timed out"

1. **`GET https://games.madladslab.com/mcp/windrose/health`** — no auth
   needed. Returns server version, protocol version, and which URLs to
   use for each transport. If this fails, the server itself is down (talk
   to the admin); the rest of this section won't help.

2. **Token sanity check**: from the terminal,
   ```
   curl -sS -X POST https://games.madladslab.com/mcp/windrose \
     -H "Authorization: Bearer <your wr_… token>" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize",
          "params":{"protocolVersion":"2025-06-18","capabilities":{},
                    "clientInfo":{"name":"manual","version":"0"}}}'
   ```
   A `result` block with `protocolVersion` proves auth + transport are
   both working. A 401 means the token is wrong or revoked. A timeout
   here means a network/proxy problem (talk to the admin).

3. **Once connected**, your very first MCP tool call should be
   `whoami` — it returns your token label, the server's view of the
   read/write scope, and the tool list. If `whoami` succeeds you're fully
   wired and the rest of the toolset works. If `whoami` returns an auth
   error, the Bearer header isn't reaching us (proxy / client config).

### Reading the server's MCP log

The admin can `tmux attach -t games` and watch `[mcp] <label> <ip> …`
lines. Every call you make appears there, with timing and (for failures)
the exact error reason. When something seems broken from your side, ask
the admin to read out the matching log lines — they almost always
diagnose the issue in one round trip:

```
[mcp] jane-the-modder 1.2.3.4 initialize -> ok [1ms]
[mcp] jane-the-modder 1.2.3.4 tools/call tool=fs_write {"path":"/etc/passwd",...} -> ERR (-32000) path not in write scope: /etc/passwd [0ms]
[mcp] auth-fail (invalid/revoked token) 1.2.3.4 POST /mcp/windrose
[mcp] legacy-sse-connect session=abc123 …
```

---

## 9. Quick orientation checklist for first connect

1. `fs_read({path:"/srv/games/windrose/MCP_HANDOFF.md"})` — this file. ✓
2. `list_mods()` — current mod set.
3. `tail_log({name:"ue4ss", lines:50})` — confirm UE4SS injected on last boot.
4. `get_events({limit:10})` — recent activity, prove the event stream is alive.
5. `tools/call whoami` — confirm the path-jail roots match what §1 says
   (they should). If they don't, the server has been redeployed with a
   different scope and this handoff is stale.
6. `fs_list({path:"/srv/games/public/windrose-map"})` and
   `fs_list({path:"/srv/games/public/windrose-build"})` — see what's already
   in each overlay so you don't trample existing work.
7. Ask the human what they actually want to build. If they say "the mod map"
   or "the world map," they almost always mean the **public Map overlay**
   at `/srv/games/public/windrose-map/`, not the admin Build overlay.

That's it. Welcome to Windrose.
