# Superadmin Dashboard — OllamaCluster Widget Handoff
**Created:** 2026-05-27  •  **Source:** `C:\OllamaCluster\` on the GPU box

This is everything you need to wire the **Ollama Tunnel** widget on `madladslab.com/superadmin` to the cluster's HTTP API. The cluster exposes ~20 JSON endpoints behind a Bearer-token gate. One endpoint (`/admin/overview`) returns everything the widget needs in a single call.

## Base URL

| Environment | URL | Notes |
|---|---|---|
| Local dev (on the GPU box) | `http://localhost:11400` | LAN-only |
| Public (production) | `https://ollama.madladslab.com` | Through Apache + SSH reverse tunnel |

**Public access caveat (2026-05-27):** Apache is currently rejecting non-`snory-admin` Bearer tokens with HTTP 403. Until that vhost is updated, only the imported-original admin token works through the public URL. The A1 key works fine on `localhost:11400`. See "Phase 3 unblock" below.

## Authentication

Every non-public endpoint requires a Bearer token via the `Authorization` header:
```
Authorization: Bearer 
```

**Scopes:** keys hold an array of scopes. The route → scope mapping:

| Route prefix | Required scope |
|---|---|
| `/health`, `/status` | none (public) |
| `/wake` | `llm` |
| `/api/*` (Ollama proxy) | `llm` |
| `/v1/images/*` | `sd` |
| `/sleep`, `/analytics/*`, `/admin/*`, `/benchmark` | `analytics` |
| `/s3/*` | `bucket` |
| `/db/*` | `database` |
| any | `*` (wildcard — used by `snory-admin`) |

**Current keys (as of handoff):**

| Label | Prefix | Scopes | Limits | Notes |
|---|---|---|---|---|
| `snory-admin` | `6255f716…` | `*` | unlimited | imported from old Apache hardcoded bearer; full admin |
| `friend-tester` | `8ebe0492…` | `llm,sd` | 60 rpm / 5000 rpd / 4 concurrent | externally distributed; do NOT grant analytics |
| `A1` | `c98e9b2a…` | `llm,sd,analytics,bucket,database` | unlimited | agent-one VM; full set of scopes |

The widget should be configured with the **`snory-admin`** Bearer (since it has `*`).

## The Single Endpoint That Powers the Widget

```http
GET /admin/overview
Authorization: Bearer <admin-bearer>
```

Returns one consolidated JSON payload. Poll this on a 15–30s interval to populate the entire Ollama Tunnel section of the panel.

### Response shape

```json
{
  "timestamp": "2026-05-27T16:48:36.505Z",
  "services": {
    "tasks": [
      { "name": "OllamaCluster", "state": "running", "stateCode": 4,
        "lastRun": "2026-05-27T16:47:47.000Z", "lastTaskResult": 267009 },
      { "name": "OllamaClusterBenchmark", "state": "ready", "stateCode": 3, ... },
      ...
    ],
    "watchdogPaused": false
  },
  "gpus": [
    {
      "gpu": 0, "port": 11435, "idx": 0,
      "status": "up",
      "activeRequests": 0,
      "cold": false,
      "loaded": [{ "name": "qwen2.5:7b", "sizeVram": 4924207104 }],
      "pinned": null
    },
    {
      "gpu": 3, "port": 11436, "idx": 1,
      "status": "up", "activeRequests": 0, "cold": false,
      "loaded": [{ "name": "qwen2.5-coder:7b", "sizeVram": 4924207104 }],
      "pinned": "qwen2.5-coder*"
    }
  ],
  "models": {
    "onDisk": [
      { "name": "qwen2.5-coder:7b", "size": 4683087561,
        "modified": "2026-05-27T10:23:28.300Z",
        "digest": "dae161e27b0e", "family": "qwen2",
        "params": "7.6B", "quant": "Q4_K_M" },
      ...
    ]
  },
  "sd":   { "status": "up", "port": 8090, "queueDepth": 0 },
  "tier": {
    "tier": "HOT", "rank": 3,
    "lastActivityAt": "2026-05-27T16:47:03.166Z", "idleSec": 111,
    "lastTransitionAt": null, "transitionReason": "init",
    "waking": false, "sleeping": false, "wakeEtaSec": 0,
    "schedule": { "darkStartHour": 1, "darkEndHour": 7, "currentlyInDarkWindow": false },
    "config": { "warmAfterSec": 1800, "coldAfterSec": 3600 }
  },
  "keys": [
    {
      "label": "snory-admin", "prefix": "6255f716", "scopes": ["*"],
      "limits": { "rpm": 0, "rpd": 0, "concurrent": 0 },
      "enabled": true, "expires_at": null, "expired": false,
      "requests_24h": 145, "errors_24h": 3,
      "bytes_in_24h": 21417, "bytes_out_24h": 100223,
      "avg_ms": 8346,
      "rpm": 0, "rpd": 0, "inflight": 0
    },
    ...
  ],
  "totals": {
    "since": "2026-05-26T16:48:54.319Z",
    "requests_24h": 158, "errors_24h": 3,
    "bytes_out_24h": 127070, "avg_ms": 7810,
    "by_scope": {
      "llm":       { "requests": 122, "bytes_in": 21545, "bytes_out": 55193, "duration_ms": 1224527, "errors": 3 },
      "analytics": { "requests": 36,  "bytes_in": 0,     "bytes_out": 71877, "duration_ms": 9464,    "errors": 0 }
    }
  }
}
```

### Widget field → payload path mapping

Maps directly to the **OLLAMA TUNNEL** card on the existing superadmin overview page:

| UI field | Source path | Format |
|---|---|---|
| `LLM ✓ · ok` | `gpus[].status` | green if any `"up"`, red if all `"down"` |
| `SD ✓ · ok` | `sd.status` | string |
| `models: <list>` | `gpus[].loaded[].name` | join unique names with `, ` |
| `REQUESTS` | `totals.requests_24h` | integer with thousands sep |
| `ERRORS` | `totals.errors_24h` | integer |
| `ERR%` | `(errors_24h / requests_24h) * 100` | 1 decimal, e.g. `2.9%` |
| `BYTES OUT` | `totals.bytes_out_24h` | bytes → MB/KB friendly |
| `AVG DUR` | `totals.avg_ms` | ms → `5.6s` style |
| `KEYS` count | `keys.length` | integer |
| **KEYS table rows** | `keys[]` | one row per key |
| ↳ `KEY` column | `keys[].label` | string; `prefix` available as subtitle |
| ↳ `REQ` column | `keys[].requests_24h` | 24h total |
| ↳ `ERR` column | `keys[].errors_24h` | 24h total |
| ↳ `RPM` column | `keys[].rpm` | live (last 60s) |
| ↳ `RPD` column | `keys[].rpd` | live (last 24h, rate-bucket source) |
| ↳ `IN` column | `keys[].inflight` | currently-running requests |

### Useful derived signals

- **Disabled key:** `keys[].enabled === false` → render with reduced opacity / "revoked" badge
- **Expired key:** `keys[].expired === true` → red badge, "expired"
- **Tier banner:** when `tier.tier === "DARK"` or `"COLD"`, show a "Sleeping (wake on first request)" notice. When `tier.waking === true`, show ETA from `tier.wakeEtaSec`.
- **Watchdog paused:** if `services.watchdogPaused === true`, show a yellow "watchdog paused" badge — service crashes won't auto-restart until resumed.

## Granular Endpoints (if `/admin/overview` is too much in one go)

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | public; cluster health + tier (no auth) |
| GET | `/status` | public; just the tier state |
| GET | `/admin/services` | services + watchdogPaused flag |
| GET | `/admin/gpus` | same shape as `overview.gpus` |
| GET | `/admin/models` | Ollama disk inventory (name/size/family/params/quant) |
| GET | `/admin/keys` | keys + scopes + limits + expiry (no analytics merge) |
| GET | `/admin/logs/cluster?tail=100` | last N lines of `cluster.log` |
| GET | `/admin/logs/watchdog?tail=100` | last N lines of `watchdog.log` |
| GET | `/admin/logs/usage?tail=200` | last N lines of `usage.ndjson` (raw NDJSON; parse client-side) |
| GET | `/analytics?since=ISO&until=ISO&key=label` | aggregate over arbitrary range |
| GET | `/analytics/keys` | keys (no secrets, no analytics) |
| GET | `/analytics/rate` | live rate-bucket state per key |

## Action Endpoints (control surface)

All require `analytics` scope. All accept JSON bodies where applicable.

### Service control

```http
POST /admin/services/<name>/restart
```
`<name>` must be one of: `OllamaCluster`, `OllamaClusterTunnel`, `OllamaSD`, `OllamaWatchdog`, `OllamaClusterBenchmark`, `OllamaMCP`. (When `OllamaBucket` and `OllamaMongo` get registered as scheduled tasks they can be added to this allowlist — see "Server-side TODOs" at the bottom.)

```http
POST /admin/watchdog/pause
Content-Type: application/json

{ "reason": "deploying new cluster.js" }
```

```http
POST /admin/watchdog/resume
```

```http
POST /admin/benchmark/run
```

### Key management

```http
POST /admin/keys/mint
Content-Type: application/json

{
  "label":   "panel-bot",
  "scopes":  ["llm", "analytics"],
  "limits":  { "rpm": 120, "rpd": 50000, "concurrent": 8 },
  "expires": "30d",
  "notes":   "key issued from superadmin panel 2026-05-27"
}
```
Returns `{ "secret": "<64-hex>", "entry": {...} }`. **The `secret` field is shown exactly once** — display it to the user and prompt them to copy it.

`expires` accepts: ISO date string, duration like `"30d"`/`"12h"`/`"90m"`/`"1y"`, or `"never"` / `null`.

```http
POST /admin/keys/<label>/assign
Content-Type: application/json

{ "scopes": ["llm", "sd", "bucket"] }
```

```http
POST /admin/keys/<label>/expire
Content-Type: application/json

{ "when": "90d" }   // or "2026-12-31" or "never"
```

```http
POST /admin/keys/<label>/revoke    # disable
POST /admin/keys/<label>/enable    # re-enable
POST /admin/keys/<label>/limits    { "rpm": 60, "rpd": 5000, "concurrent": 4 }
DELETE /admin/keys/<label>         # permanent removal
```

### Mint UI suggestions

A key-creation form in the panel should:
- Take **label** (no spaces), **scopes** (multi-select from `llm, sd, analytics, bucket, database`), **rpm/rpd/concurrent** (numeric, 0 = unlimited), **expires** (text: "30d" / "never" / ISO), **notes** (optional)
- Display the returned `secret` in a copy-to-clipboard block with strong "this is shown once" warning
- After dismissal, hit `GET /admin/keys` to refresh the table

## Data Plane Endpoints (apps consume these directly; widget may also)

These are the actual app-facing routes. Keys with the right scopes call them; the panel doesn't typically need to.

### S3 (MinIO)
```http
GET    /s3/                       # list buckets
PUT    /s3/<bucket>/              # create bucket
DELETE /s3/<bucket>/              # delete bucket
GET    /s3/<bucket>/              # list objects
PUT    /s3/<bucket>/<key>         # upload object
GET    /s3/<bucket>/<key>         # download object
DELETE /s3/<bucket>/<key>         # delete object
```
Bearer authed (scope: `bucket`); cluster.js strips the Bearer and re-signs with MinIO root creds (AWS SigV4, UNSIGNED-PAYLOAD).

### MongoDB
```http
GET    /db                                List databases
GET    /db/<db>                           List collections
GET    /db/<db>/<coll>?q=<json>&limit=&sort=<json>&skip=
GET    /db/<db>/<coll>/<id>               findOne by _id (ObjectId hex or string)
POST   /db/<db>/<coll>                    insertOne — body = document
PUT    /db/<db>/<coll>/<id>               replaceOne (upserts)
PATCH  /db/<db>/<coll>/<id>               updateOne with $set
DELETE /db/<db>/<coll>/<id>               deleteOne
POST   /db/<db>/<coll>/_find              { filter, projection, sort, limit, skip }
POST   /db/<db>/<coll>/_agg               [ ...aggregation pipeline ]
POST   /db/<db>/<coll>/_count             { filter }
```
Bearer authed (scope: `database`); cluster.js holds a single root-authed MongoDB connection and proxies. System dbs `admin`/`local`/`config` are blocked.

## CORS

All non-public endpoints respond to `OPTIONS` preflight with:
```
Access-Control-Allow-Origin:  *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS  (varies per route)
Access-Control-Allow-Headers: Content-Type, Authorization  (plus x-amz-* on /s3)
```
The panel can call from any origin. The Bearer is included via `Authorization`.

## Error responses

All errors return JSON with `{ "error": "<code>", "message"?: "..." }`:

| Status | When | Notes |
|---|---|---|
| 401 | missing/invalid bearer | sets `WWW-Authenticate: Bearer realm="ollama-cluster"` |
| 403 | wrong scope | response includes `scopes: [...]` (the key's current scopes) |
| 429 | rate limit hit | sets `Retry-After`; error is one of `rate_limit_per_minute`/`rate_limit_per_day`/`rate_limit_concurrent` |
| 502 | backend down (MinIO/Mongo unreachable) | error: `minio_unavailable` / `mongo_unavailable` |
| 503 | service unconfigured (env file missing) | error: `minio_unconfigured` / `mongo_unconfigured` |
| 500 | other backend error | error: `mongo_error` for Mongo driver errors etc. |

## Polling pattern

```js
async function refreshOllamaTunnel() {
  const r = await fetch(`${BASE}/admin/overview`, {
    headers: { 'Authorization': `Bearer ${ADMIN_BEARER}` },
  });
  if (r.status === 401) { /* token rotated — re-auth */ return; }
  if (!r.ok) { /* show "unreachable" badge */ return; }
  const data = await r.json();
  paintWidget(data);
}
setInterval(refreshOllamaTunnel, 20_000);
refreshOllamaTunnel();
```

A 20s cadence is a good default. The `keys[].inflight` and `keys[].rpm` fields are live (from in-memory rate buckets), so you'll see real-time activity without aggressive polling.

## Server-side TODOs (info only — already known)

Two follow-ups on the cluster side that don't block the panel build:

1. **OllamaBucket and OllamaMongo scheduled tasks need a one-time admin install** (UAC). Until then those services run under whoever started them and won't survive reboot. Action item is in `C:\OllamaCluster\install-bucket-task.ps1` and `install-mongo-task.ps1`.
2. **Apache vhost on `ollama.madladslab.com` currently 403s non-original-admin Bearers.** Until the SetEnvIf/regex check is widened, the panel needs to talk to the cluster either via local LAN (`http://gpu-box:11400`) or wait for Phase 3 of the cluster rollout. The panel itself doesn't need changes — just configure the BASE URL appropriately.

When `OllamaBucket` / `OllamaMongo` ARE registered, add them to the service-restart dropdown by appending to the array of names the panel knows about.

## File locations on the cluster server (for reference / debugging)

| What | Where |
|---|---|
| LB code | `C:\OllamaCluster\cluster.js` |
| Auth + analytics | `C:\OllamaCluster\auth-analytics.js` |
| Keys store | `C:\OllamaCluster\keys.json` (hashed; never commit) |
| Usage log | `C:\OllamaCluster\usage.ndjson` (one JSON per request; never commit) |
| Key CLI | `C:\OllamaCluster\mint-key.js` |
| MinIO creds | `C:\OllamaCluster\minio.env` |
| Mongo creds | `C:\OllamaCluster\mongo.env` |
| MinIO data | `G:\application_Data\minio\data\` (8TB HDD) |
| Mongo data | `C:\application_Data\mongo\data\` (SSD) |
| Cluster log | `C:\OllamaCluster\cluster.log` |
| Watchdog log | `C:\OllamaCluster\watchdog.log` |
