# Handoff → Ollama Cluster (winhost GPU box)

**Date:** 2026-07-02
**From:** slab app-side debugging (Asset Agent failures)
**To:** whoever owns the Ollama/SD cluster on `winhost`
**Status:** App-side mitigations shipped. Root cause is backend instability — needs work on the cluster.

---

## TL;DR

The slab **Asset Agent** (social image generator) intermittently failed with
`Unexpected token '<', "<!DOCTYPE"...` in the browser. That was a symptom, not the cause.

Root cause: the **AI backend on `winhost` drops connections / times out** under load.
Logs show `wsarecv: An existing connection was forcibly closed by the remote host`
and `The operation was aborted due to timeout`. When a request dies mid-flight, the
proxy returns an HTML error page and the (previously unguarded) frontend choked on it.

App side is now hardened. **The remaining work is on the cluster: make SD/LLM inference
reliable and fast enough that requests don't get force-closed.**

---

## The backend, as slab sees it

| Thing | Value |
|---|---|
| LLM endpoint | `https://ollama.madladslab.com/v1/chat/completions` (OpenAI-compatible) |
| SD image endpoint | `https://ollama.madladslab.com/v1/images/generations` |
| Model | `qwen2.5:7b` (`OLLAMA_MODEL`) |
| Auth | `Authorization: Bearer <OLLAMA_KEY>` |
| Host box | `winhost` = `172.17.0.1` (WSL/host gateway → the Windows GPU machine) |
| Also on winhost | MinIO (`http://winhost:9000`), self-hosted tenant MongoDB (`winhost:27017`) |

Config lives in `/srv/slab/.env` (`OLLAMA_URL`, `OLLAMA_KEY`, `OLLAMA_MODEL`) and is
wired in `/srv/slab/plugins/agentMcp.js`.

### Client-side timeouts already in place (agentMcp.js)
- `callLLM` → 90s (`timeoutMs = 90000`)
- `callVisionLLM` → 120s
- `generateSdImage` → **90s** hard abort
- SD request params: `num_inference_steps: 25`, `guidance_scale: 7.5`, `n: 1`,
  sizes 384–640px (see `SD_SIZE_MAP`)

If the box can't return an SD image within 90s, slab aborts → generation fails.

---

## Evidence

From `journalctl -u srv-slab.service`:

```
[master-agent/briefing] LLM failed, falling back: LLM request failed:
  ...wsarecv: An existing connection was forcibly closed by the remote host.
[master-agent/briefing] LLM failed, falling back: The operation was aborted due to timeout
POST /admin/assets/agent 200 48821 ms   <- succeeded, but took 48s
POST /admin/assets/agent 200 42206 ms   <- succeeded, but took 42s
```

Successful Asset Agent calls routinely take **42–48s**, right at the edge. `wsarecv`
is a Windows socket error → the connection is being torn down on the Windows/winhost
side, not by slab or by Linux.

---

## What was already fixed on the app side (do NOT redo)

1. **Frontend response guard** — `slab/views/admin/assets/social.ejs` (~line 2985).
   Stops blindly calling `r.json()`; on a non-JSON/HTML error page it now shows a
   clear message ("service timed out or unavailable (HTTP 5xx) — try again") instead
   of `Unexpected token '<'`.

2. **Default to 1 SD variation instead of 2** — `slab/routes/admin/assets.js` (~line 493).
   Halves per-request inference load & wall-time. Caller can still opt into 2 via
   `req.body.variations` (clamped 1–2).

Both are live (service restarted). These reduce *frequency* and *legibility* of
failures but do not fix the backend.

---

## Open work on the cluster (the actual ask)

Investigate on `winhost` why inference connections get force-closed / slow:

- [ ] **Is SD the bottleneck?** A 512×512 / 25-step SD image should be a few seconds on
      a real GPU. 40–90s suggests CPU fallback, cold model load per request, VRAM
      thrashing, or the SD server not keeping the model resident.
- [ ] **Confirm GPU is actually being used** (not CPU): `nvidia-smi` during a request;
      check the SD server logs for device = cuda.
- [ ] **Keep models warm** — Ollama: set `OLLAMA_KEEP_ALIVE` (e.g. `-1` or `30m`) so
      `qwen2.5:7b` isn't reloaded per call. Same idea for the SD backend (keep pipeline
      resident, don't reload weights each request).
- [ ] **Concurrency** — if slab or other tenants fire multiple SD/LLM calls at once,
      is the box serializing or OOMing? Check `OLLAMA_NUM_PARALLEL` / SD queue depth.
- [ ] **The `wsarecv` reset** — find what closes the socket: Windows firewall/idle
      timeout on the tunnel, the SD/Ollama process crashing/restarting, or a reverse
      proxy in front of `ollama.madladslab.com` with its own short timeout.
- [ ] **What terminates `ollama.madladslab.com`?** It is NOT this Apache box
      (`/etc/apache2/sites-available` has no ollama vhost). Find that hop and check its
      proxy/read timeout — if it's < 90s it will cut SD requests off before slab does.
- [ ] **Idle keepalive on the SSH reverse tunnel** (winhost is reached over a tunnel) —
      add `ServerAliveInterval`/`ClientAliveInterval` so long inference calls aren't
      dropped as idle.

### Quick repro from the app box
```bash
# LLM
time curl -sS https://ollama.madladslab.com/v1/chat/completions \
  -H "Authorization: Bearer $OLLAMA_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"qwen2.5:7b","messages":[{"role":"user","content":"hi"}]}' | head -c 300

# SD image (watch wall-time; should be seconds on GPU, not 40s+)
time curl -sS https://ollama.madladslab.com/v1/images/generations \
  -H "Authorization: Bearer $OLLAMA_KEY" -H 'Content-Type: application/json' \
  -d '{"prompt":"a blue abstract background","size":"512x512","n":1,"num_inference_steps":25,"guidance_scale":7.5}' \
  -o /dev/null -w 'HTTP %{http_code} in %{time_total}s\n'
```
Run both several times back-to-back to surface the intermittent reset and cold-vs-warm
timing difference.

## Definition of done
SD `images/generations` returns in a stable few seconds (warm), no `wsarecv` resets
across ~10 back-to-back calls, and the Asset Agent completes well under the 90s abort.
Once stable, consider re-enabling the 2-variation default.

---

## RESOLVED on the cluster — 2026-07-02 (winhost side)

Investigated on `winhost`. GPU **is** in use for SD (nvidia-smi GPU2 at 84% / 4.2 GB
during a request — not CPU fallback). The stalls + resets traced to three things,
all now fixed:

1. **LLM cold reloads** — `KEEP_ALIVE` was `5m`; measured **9.2s cold vs 0.5s warm**
   on GPU0. Any gap >5 min made the next call eat ~9s, pushing app calls toward the
   90s abort. → raised to **30m** (`cluster.js`; env-overridable via `OLLAMA_KEEP_ALIVE`).
   Tier demotion still injects `keep_alive:0`, so idle VRAM/heat is unchanged.

2. **SD cold wakes** — `SD_IDLE_UNLOAD_SEC` was `600`; the pipeline had fully
   unloaded (`allocated_gb:0`). Measured **10s cold vs 6s warm** (512px). → set to
   **0** during active hours (`C:\sd_service\run.ps1`). GPU2 is dedicated to SD, so
   keeping it resident is free; tier `/sleep` still releases VRAM in the 01:00–07:00
   DARK window.

3. **The `wsarecv` resets — root cause** ⚠️ — the LB proxied the upstream response
   stream with **no `proxyRes.on('error')` handler** and had **no `uncaughtException`
   guard**. A single ollama/SD mid-stream reset (the known flaky-GPU TDR) threw
   unhandled and **crashed the whole LB**, so the watchdog restart force-closed every
   in-flight connection across all 18 domains at once — an intermittent `wsarecv`
   storm, not a per-request failure. → added stream-error handlers on both the LLM
   and SD proxies + global `uncaughtException`/`unhandledRejection` guards
   (`cluster.js`). The LB now survives an upstream reset; only the one request fails.

Verified after restart (watchdog paused during rollout, resumed after): LB health 200;
LLM warm 0.5s / via LB 1.1s / public path 1.6s; SD warm via LB 7.4s; model `UNTIL`
now ~30 min; SD `tier_state:hot, idle_unload_sec:0`.

**App side can re-enable the 2-variation default when ready.** Note the SSH tunnel
already had `ServerAliveInterval=30` keepalive, so that item was already handled.

**Not fixed (out of scope, needs hardware/driver work):** the underlying NVIDIA
driver instability (TDR / `nvlddmkm`) that causes the resets in the first place. These
changes make the cluster *survive* a reset gracefully instead of cascading; the real
fix is still DDU + clean NVIDIA reinstall (see CLAUDE.md).
