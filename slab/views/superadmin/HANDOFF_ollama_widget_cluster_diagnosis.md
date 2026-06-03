# Ollama Widget — Cluster Reachability Handoff
**Created:** 2026-05-27 18:30  •  **From:** slab (madladslab.com superadmin) side  •  **To:** cluster ops (GPU box / Linode Apache vhost)

The superadmin Ollama Tunnel widget is wired per `HANDOFF_superadmin_dashboard.md` but renders blank ("—" everywhere) because **every authenticated cluster endpoint times out**. Public `/health` succeeds (slowly). This document captures exactly what slab is doing so you can diagnose from the cluster end.

## What slab is calling

All cluster requests originate from the slab process (`/srv/slab`, port 3602, Node 22, `node bin/www.js`) and go to the **public URL** via DNS — slab does NOT use the LAN/local LB.

```
Base URL:  https://ollama.madladslab.com
Method:    GET (POST/DELETE for control surface)
Headers:
  Accept: application/json
  Authorization: Bearer 6255f716c9107e6e90de1cb06389a5fa763d4d6d7a5dd8d7b9063ea4c1db2c64
  Content-Type: application/json     (only for POST/DELETE)
Timeout:   25000 ms (overview); 6000-8000 ms (everything else)
```

The bearer is the **snory-admin** token (prefix `6255f716`, scopes `*`), pulled from `/srv/slab/.env` (`OLLAMA_KEY=...`) via `config.OLLAMA_KEY`. Token verified against `/etc/apache2/sites-enabled/ollama-madladslab-le-ssl.conf` line 10 — exact match, no regex escaping issues.

Code paths:
- Helper: [routes/superadmin.js:704](/srv/slab/routes/superadmin.js#L704) `ollamaFetch()` — global `fetch()` + `AbortController` timeout
- Health: [routes/superadmin.js:730](/srv/slab/routes/superadmin.js#L730) `/health` and `/health/sd` (no auth)
- Overview: [routes/superadmin.js:762](/srv/slab/routes/superadmin.js#L762) `/admin/overview` (auth)
- Probe: [routes/superadmin.js:770](/srv/slab/routes/superadmin.js#L770) `GET /superadmin/api/ollama/_probe` — round-trips every endpoint with 6s timeout (use this to diagnose from the slab side)
- Legacy fallback: `/analytics`, `/analytics/keys`, `/analytics/rate` (also failing)

## What we observe from slab (last ~10 min, captured 2026-05-27 18:25-18:30)

```
GET /superadmin/api/ollama/health         200 6004 ms  134 B    ← works (slow)
GET /superadmin/api/ollama/overview       502 25605 ms  72 B    ← aborted by client timeout
GET /superadmin/api/ollama/keys           502  6034 ms  72 B    ← aborted (timeout 6s)
GET /superadmin/api/ollama/rate           502  6034 ms  72 B    ← aborted
GET /superadmin/api/ollama/analytics      502 10002 ms  72 B    ← aborted
```

Captured upstream response for `/admin/overview` (`/tmp/slab_ollama_overview_debug.json`):
```json
{ "ok": false, "status": 0, "error": "This operation was aborted", "data": null }
```

`status: 0` means slab's `fetch()` never got a response header back — the connection just hung until our AbortController fired.

`/health` returns `200` but takes **6 seconds**, which is suspicious. Apache content-rewrites HTML clients to `/var/www/ollama-status/index.html`, but JSON clients (`Accept: application/json`, like slab) should pass through to `localhost:11400/health` and come back fast.

## What we observe from CLI (same Linode host as slab, different process)

Same outbound path (DNS → `ollama.madladslab.com`), but **every** curl request times out at whatever `-m` we set:

```
$ curl -m 10 https://ollama.madladslab.com/health → HTTP 000 (10s timeout)
$ curl -m 35 -H "Authorization: Bearer 6255f716..." https://ollama.madladslab.com/admin/overview → HTTP 000 (35s timeout)
$ curl -m 8  http://localhost:11400/admin/overview → HTTP 000 (8s timeout)  ← direct via SSH tunnel also hangs
```

Note: an earlier `curl` minutes prior returned `HTTP 403 time=0.031s` for the public root with no auth — so basic Apache is responsive intermittently. The pattern looks like the **upstream localhost:11400 (cluster.js LB) is hanging or stuck**, not the network layer.

Port 11400 IS listening locally (sshd reverse tunnel from GPU box):
```
ss -tlnp | grep 11400
LISTEN  127.0.0.1:11400  pid=2602651  sshd
LISTEN  [::1]:11400      pid=2602651  sshd
```

So the SSH tunnel is up, but the cluster.js process on the GPU box seems to be accepting connections and never replying (or replying very slowly only for the simplest paths).

## Likely root cause

One of:
1. **cluster.js on the GPU box is wedged** — process is alive but its request loop is stuck (waiting on Ollama upstream, OOM-thrashing, GC death, or a hung sync call). The fact that `/health` *eventually* responds in 6s while authenticated routes never respond suggests the auth middleware or the analytics/key store is the bottleneck.
2. **The SSH reverse tunnel is unidirectional or half-open** — connections accept but no data flows through reliably. `ss -ti` on the tunnel socket would tell.
3. **Apache → localhost:11400 is hitting `ProxyTimeout 240` for authed routes** — slab times out first (25s), but Apache may also be holding the connection open. The vhost says `disablereuse=on`, so it's not a stale-conn pool issue.

## What I'd like the cluster side to check

On the GPU box (`C:\OllamaCluster\`):

1. **Is cluster.js responsive locally?** From the GPU box itself:
   ```powershell
   curl http://localhost:11400/health                  # should be instant
   curl -H "Authorization: Bearer 6255f716..." http://localhost:11400/admin/overview
   curl -H "Authorization: Bearer 6255f716..." http://localhost:11400/admin/services
   ```
   If these hang on the GPU box itself, the LB is wedged — restart cluster.js (the `OllamaCluster` scheduled task), or `OllamaClusterTunnel`.

2. **Tail `C:\OllamaCluster\cluster.log` and `watchdog.log`** for recent errors, hung-handler logs, or watchdog "paused" state. Per the handoff, `services.watchdogPaused` would suppress restarts.

3. **Are the GPUs awake?** The tier system may have entered DARK/COLD. The wake path *should* be transparent (`/wake` is auto-fired on llm requests), but `/admin/overview` doesn't go through the wake middleware — if the cluster is sleeping, `/admin/overview` may be blocking on a startup operation.

4. **Has `/admin/overview` actually been deployed?** Per the handoff doc this is the new consolidated endpoint. If the cluster.js currently running on the GPU box is older than the handoff revision, `/admin/overview` may not exist (which would explain hangs if the router falls through to a default proxy-to-Ollama handler that waits for an Ollama upstream that doesn't reply).

5. **Test the SSH reverse tunnel** from GPU box back to Linode — there have been reports of half-open tunnels that accept TCP but block app traffic. A fresh `ssh -R 11400:localhost:11400 root@<linode>` from the GPU box will reset it.

## What the slab side already handles

- **Graceful degradation**: when all upstream fetches fail, the widget renders "—" placeholders and a single "unreachable" pill. No JS errors, page stays interactive.
- **Cold tier wake-up**: overview timeout bumped to 25s so first-fetch-after-sleep has time.
- **Bearer**: snory-admin (`*`-scope) — works against the current Apache vhost regex (line 10 of the vhost is an exact match).

Once the cluster responds, the widget will start populating without any changes here. No client redeploy required.

## To verify recovery from the slab side

After fixing the cluster, hit (logged in as superadmin):
```
GET https://madladslab.com/superadmin/api/ollama/_probe
```
This pings 9 endpoints with 6s budgets and returns `{ status, ok, ms, err, sample }` per path. Anything that returns `ok:true` with a small `ms` is working. Anything stuck at `status:0` means the connection still hangs.

Then a normal load of `/superadmin` should immediately populate the Ollama Tunnel tile.
