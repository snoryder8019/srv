# Triple-Twenty ↔ Ollama Dartboard Handoff

**From:** triple-twenty app (running on the web host, port 3710)
**To:** Ollama dartboard endpoint (running on the GPU host behind `ollama.madladslab.com`)
**Date:** 2026-04-21
**Status:** Model reachable, endpoint reachable, but detection output is empty every single call across every session.

---

## The one-sentence summary

The triple-twenty app talks to `POST https://ollama.madladslab.com/dartboard/analyze` with a base64 JPEG and expects back a JSON object with a `darts[]` array. We have 7 recorded analyze calls with real dartboard frames submitted. The AI returned **zero darts on every one of them**. Health says the model (`llava:7b`) is loaded and up. So something between "healthy model" and "useful output" is broken on the Ollama side.

---

## What the app sends

### Endpoint

```
POST https://ollama.madladslab.com/dartboard/analyze
Authorization: Bearer <OLLAMA_KEY>
Content-Type: application/json
```

### Request body

```json
{
  "image": "<base64-encoded JPEG, no data: prefix, ~100-500KB>"
}
```

That's it. No `examples[]`, no `gameId`, no prompt override. The app sends the image as a bare base64 string and expects the model to do its job.

### Timeout

The app aborts the request after **12 seconds** (configurable via `OLLAMA_TIMEOUT_ANALYZE` env var, default 12000ms). This is probably too tight for `llava:7b` cold starts and is likely why "AI unavailable" shows up sometimes. More on that below.

### Call frequency

- User taps Capture button → 1 call
- User toggles Auto → 1 call every 4s per tab
- User enables Learning Mode and taps a dart in the scoring pad → 1 call per tap (up to 3 per round)
- App-level health probe → 1 call every 15s server-side, coalesced across all clients

For a typical single-user session, expect ~5–20 analyze calls per minute.

---

## What the app expects back

### Success shape

```json
{
  "darts": [
    { "segment": 20, "ring": "triple", "score": 60 },
    { "segment": 4,  "ring": "single", "score": 4 },
    { "segment": 9,  "ring": "single", "score": 9 }
  ],
  "total": 73,
  "confidence": "high",
  "note": "optional — free-form string"
}
```

### Field requirements

- **`darts`** — array of 0–3 objects. Empty array is valid ("saw nothing") but means the app will not auto-score.
- **`segment`** — integer. For normal segments: 1–20. For bull: 25 is acceptable. For miss: 0.
- **`ring`** — string, one of exactly: `"single"`, `"double"`, `"triple"`, `"inner_bull"`, `"outer_bull"`, `"miss"`.
- **`score`** — integer. Must match `segment × multiplier` (or 50 for inner_bull, 25 for outer_bull, 0 for miss). The app trusts this value, it does not recompute.
- **`total`** — integer. Sum of the dart scores. App displays this but also recomputes from darts on submit.
- **`confidence`** — string. Used for styling a badge in the UI. Free-form but expected values: `"high"`, `"medium"`, `"low"`. Anything else is displayed verbatim.
- **`note`** — optional free-form string. Shown in the AI Trigger Log panel.

### Special-case response (tunnel up, model missing)

The app checks for 404 and treats it as "model not deployed":

```json
{
  "darts": [],
  "total": 0,
  "confidence": "unavailable",
  "note": "dartboard model not deployed on tunnel (404)",
  "available": false
}
```

The app synthesizes this shape client-side when the upstream returns 404. If the Ollama side wants to signal "I'm up but I don't have the model," returning a 404 on `/dartboard/analyze` will trigger this graceful degradation.

### Error response shape (what the app expects on failure)

The app will accept anything that comes back with HTTP 2xx. On non-2xx, it builds its own error payload client-side and logs it. No specific error shape is required from Ollama.

---

## What the app is actually receiving

### From the data

- **7 corrections captured in MongoDB** since we started tracking. Every single one has `ai.darts.length === 0`. That is a 100% empty-detection rate.
- Notes on those records: 5 × `learning:mismatch`, 2 × `learning:no-ai`. The "mismatch" tag means the user tapped a dart manually and the AI returned empty for that frame. "No-ai" means Learning Mode was on but the AI wasn't available.
- No correction has ever been saved where `ai.darts` contained anything.

### From the AI Trigger Log UI (user reported)

Two flash messages observed during a recent session:

1. **"🤖 AI unavailable"** → maps to `analysis.available === false`. Most likely cause: the app's 12-second abort timeout is firing before a cold-GPU `llava:7b` call can complete.
2. **"🤖 AI saw nothing this frame"** → successful 2xx response, but `darts: []`. This is the model running and returning empty.

Both states happen in the same session. That means sometimes the request completes and returns empty, sometimes it doesn't complete in time.

### From the health endpoint right now

```json
{
  "backend.dartboard": {
    "gpu": 0,
    "port": 11434,
    "model": "llava:7b",
    "status": "up"
  },
  "app.dartboard": { "status": "up" }
}
```

Model is loaded on GPU 0 at port 11434. It responds to probes. So the path from app → tunnel → model is intact. The problem is in what the model actually outputs.

---

## The likely root causes, ranked

1. **`llava:7b` was never trained to output structured dart detections.** It is a general-purpose vision-language model. Asking it to return `{segment, ring, score}` JSON for darts on a board is asking it to hallucinate a schema it doesn't know. Most of the time it returns an empty array because whatever prompt + JSON parser is wrapping it doesn't get a parseable response.
2. **The prompt on the Ollama side may be parsing responses too strictly.** If the wrapper extracts JSON with a regex that requires a specific structure, and LLaVA returns prose or partial JSON, the wrapper probably falls back to `{darts: [], total: 0}` rather than crashing.
3. **Cold-start timeouts on the app side** are killing the 15–30s first call that LLaVA needs to warm up. This explains "AI unavailable" flashes. It does not explain why the warm calls also return empty.

---

## What I need from the Ollama side to continue

In priority order:

### 1. Raw response inspection (highest value)

For the next 5–10 `/dartboard/analyze` calls, capture and share:

- The raw text LLaVA returns (before any JSON parsing / wrapping).
- The exact prompt being sent to LLaVA.
- The parser/extraction code that turns LLaVA's response into `{darts, total, confidence}`.
- Elapsed time per call (cold vs warm).

This tells us whether the model is returning nothing, returning garbage, or returning something parseable-but-the-parser-is-dropping-it.

### 2. The prompt template

Whatever `/dartboard/analyze` is sending to LLaVA as the prompt. I suspect this is where the biggest win is — prompt engineering a VLM to output strict JSON is its own art form and the current prompt may just be asking for too much.

### 3. Honest assessment of the model choice

- Is `llava:7b` the intended long-term model, or a placeholder?
- Is there a plan for a dartboard-specific fine-tuned model (YOLO, RT-DETR, fine-tuned VLM)?
- If we're going to stay with LLaVA-class models, should we bump to `llava:13b` or `llava:34b` for better reasoning? Does the GPU have headroom?

### 4. Cold-start behavior

- What's the cold → warm time for `llava:7b` on your GPU when it has to load from disk?
- Is there a way to keep the model warm (periodic pings, always-loaded flag)?
- Would be nice to have a `GET /dartboard/warm` endpoint I can hit from the app to preload the model before gameplay starts.

---

## What the app will do in the meantime

Nothing invasive. Current behavior:

- App will continue sending `/dartboard/analyze` calls.
- Empty responses render as "🤖 AI saw nothing this frame" under the camera feed, **do not** disrupt manual scoring.
- Unavailable responses (timeout/5xx) render as "🤖 AI unavailable," same non-disruptive treatment.
- Manual tap pad continues to be the primary scoring surface. Users can play full games without the AI ever working.
- All 7 corrections + every future correction are still being captured to Mongo for eventual training data, even though the AI side is empty on every call.

---

## Things I might ask you to change, once we've inspected raw output

Depending on what we see in the raw LLaVA responses, candidate next steps:

- **App-side**: bump `OLLAMA_TIMEOUT_ANALYZE` from 12000ms to 30000ms to accommodate cold starts.
- **Ollama-side**: rework the prompt, tighten JSON schema enforcement, add a retry-with-simpler-prompt fallback.
- **Ollama-side**: add the `examples[]` field support so the app can start shipping the last-6-corrections for in-context learning (this is in CALUDE.md as step 4 of the ML loop but was never wired on either side).
- **Architecture-level**: if LLaVA-7B genuinely can't do this task, plan the migration to a dartboard-specific detector. Discuss whether training data (the corrections we've collected) is useful as fine-tuning input or if we need a different base model entirely.

---

## Quick-reference: test the endpoint from the Ollama side

```bash
# Health check
curl -s https://ollama.madladslab.com/health | jq

# Fire a probe like the app does
curl -s -X POST https://ollama.madladslab.com/dartboard/analyze \
  -H "Authorization: Bearer $OLLAMA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"probe":true}'

# Send a real image (replace with actual base64 of a dartboard photo)
curl -s -X POST https://ollama.madladslab.com/dartboard/analyze \
  -H "Authorization: Bearer $OLLAMA_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"image\":\"$(base64 -w 0 dartboard.jpg)\"}" | jq
```

If that last call returns `{darts: [], total: 0, ...}` on a clear dartboard photo with real darts visible, the model+prompt combo is the problem. If it returns actual detections, the problem is elsewhere and we should look at what's different between curl and the app.

---

**End of handoff.** Ping me back when you've captured a few raw responses or a prompt template, and we'll pick up from there.
