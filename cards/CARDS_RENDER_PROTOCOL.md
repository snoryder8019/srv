# Cards Render Protocol — visual + animation stack — v1

**Status:** active · **Started:** 2026-05-30 · **Module:** `/srv/cards/public/js/cards-render.js`
**Assets:** `/srv/cards/public/img/assets/*.png` (served at `/static/img/assets/`)

The shared, framework-free canvas-2d layer every cards variant draws through. It owns the
**table art**, **card faces/backs**, **fan layout**, and a small **flight animation engine**
(deal / play). A variant supplies a `drawBoard` and a seat layout; backs on opponents'
hands, the felt/rail/crest table, and deal/play motion come for free. Euchre is the
reference integration; **hearts** will reuse this unchanged.

---

## 1. Art assets (Stable Diffusion)

Generated offline via the GPU gateway and committed as PNGs (never generated in a request
path). Gateway: `ollama.madladslab.com` → SSH tunnel `localhost:11400`, OpenAI-style.

```
POST /v1/images/generations        Authorization: Bearer <OLLAMA_KEY>
{ "prompt": "...", "negative_prompt": "...", "n":1, "size":"512x512", "steps":22 }
-> { "data": [ { "b64_json": "<base64 png>" } ] }      (SD v1.5; ~6s warm at 512²)
```
- `OLLAMA_KEY` lives in `/srv/td/.env` (shared GPU tunnel, per-service key). `/health/sd` is open.
- Generator: **`/srv/cards/scripts/gen-assets.mjs`** — `OLLAMA_KEY=… node scripts/gen-assets.mjs`.

Current asset set (512×512):
| File | Use | Prompt gist |
|---|---|---|
| `card-back.png` | opponents' face-down hands, deck, deal flourish | ornate damask filigree, crimson + gold medallion |
| `felt.png` | table surface (tiled pattern) | seamless dark green wool felt weave |
| `rail.png` | table border stroke | mahogany wood + black leather rail |
| `crest.png` | faint centre emblem | four-suit heraldic gold crest |

To add/replace art: add an entry to `gen-assets.mjs` (file, prompt, size, steps), run it,
and reference it in the module. SD v1.5 is strongest at 512×512; avoid text in prompts
(use the shared negative prompt — it bans letters/numbers/watermarks).

---

## 2. Module API (`window.CardsRender`)

```js
await CardsRender.loadAssets(base='/static/img/assets');  // preloads felt/rail/back/crest (fire-and-forget OK)
CardsRender.loop((ctx,W,H,now) => drawBoard(...));         // starts the single rAF loop; safe to call once
CardsRender.drawTable(ctx,W,H);                            // felt + vignette + faint crest + rail border
CardsRender.cardFace(ctx,x,y,w,h,'10S',{highlight});       // a face (rank+suit, red/black, shadow)
CardsRender.cardBack(ctx,x,y,w,h);                         // a face-down back (SD art, clipped)
CardsRender.fanPositions(cx,cy,n,{vertical,step});         // -> [[x,y],…] centred fan
CardsRender.fly({from:[x,y],to:[x,y],dur,draw(ctx,x,y,e),onDone});  // queue a flight
CardsRender.busy();                                        // any flights active?
CardsRender.cardW/cardH/backW/backH                        // default sizes
```
**Card code format:** `<rank><suit>` where suit ∈ `H D C S` (e.g. `"10S"`, `"JD"`, `"AH"`).
Red = H/D. Faces are vector-drawn (crisp at any size); backs use the SD image.

The loop draws the static board each frame (your `drawBoard`) then overlays active flights
on top — so animations float above the board with zero board-state mutation.

---

## 3. Integration pattern (how a variant configures in)

Euchre's client does, in full:
1. `<script src="/static/js/cards-render.js">` after socket.io.
2. Define seat geometry on the fixed **760×360** internal canvas:
   `relOf(seat)` (rotate so *my* seat is at the bottom), `SEATXY`, `TRICKXY`, `HANDXY`.
3. Define `drawBoard(ctx,W,H,now)`: `CardsRender.drawTable` → opponents' **card-back fans**
   (`oppHandCount` × `cardBack`) → seat plates (turn pulse via `sin(now)`) → current trick
   (`cardFace`, skipping any card in `inFlight`) → up-card.
4. Boot once: `CardsRender.loadAssets(); CardsRender.loop(drawBoard);`.
5. Drive motion from state diffs in one `onState(s)`:
   - new `handNo` → `animateDeal` (backs fly from dealer to each seat),
   - trick grew → `animatePlay` (the played `cardFace` flies seat→trick slot; its key is held
     in `inFlight` so the board doesn't double-draw it until it lands).

**Opponent hands = backs.** Counts are derived client-side (`5 - tricksPlayed - playedThisTrick`
in play; 5 during bidding) — no server change. Your own hand stays the interactive DOM chips
below the canvas.

A new variant only changes: the seat geometry, `drawBoard` contents (e.g. hearts has no
trump banner, 13-card fans, per-player scores), and which events trigger animations. Faces,
backs, table, fan math, and the flight engine are shared.

---

## 4. Roadmap
- Card **flip** animation (back→face) on reveal; **trick-gather** (winner sweeps the 4 cards).
- Optional per-rank pip layouts / face-card art (SD) if we want richer faces.
- Light **sound** hooks (deal/play/win) behind a mute toggle.
- A small **sprite-sheet** build so 52 faces can be pre-rasterized if vector drawing ever costs.

---

## Sound kit (2026-05-30)
`CardsRender.Sound` — WebAudio synth (no asset files), respects a mute flag persisted in
`localStorage` (`cards_muted`). Browsers need a user gesture to start audio, so the client
calls `Sound.resume()` on first pointerdown and on the mute toggle.
Cues: `deal`, `play`, `yourTurn` (chime when the clock lands on you), `trick`, `win`, `lose`,
`alert` (timeout), `tick`. A variant just calls these from its state-diff handler; euchre
fires `deal` on a new hand, `play` on trick growth, `yourTurn` on the clock, `win/lose` on the
end screen, `alert` on `turn:timeout`. Mute button is the 🔊/🔇 toggle top-right.
