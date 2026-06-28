# Handoff — S3/object-storage cutover (slab side, step 2)

**Date:** 2026-06-27
**From:** VPS `104.237.138.28` (/srv/slab). Pairs with `HANDOFF-s3-surface.md` (operator's step 1).
**Status:** Public CDN surface LIVE. **Tooling built + tested. greeality fully cut over and verified. The rest awaits the bulk object mirror.**

---

## TL;DR
- The slab-side cutover is **pre-wired and proven**. One tenant (**greeality**) is live on `cdn.madladslab.com`, verified end-to-end (pages render cdn URLs, objects resolve 200, zero Linode refs left).
- Remaining work is mechanical and gated on **one operator step**: the bulk `mc mirror` (§3a) + the `slab_rw` secret. After that, full cutover is **2 commands + an env edit**.

## What I proved (greeality — done, do not redo)
1. Copied greeality's 6 objects Linode→MinIO → cdn serves them (200, correct bytes/type).
2. Ran the URL rewrite → 10 docs swapped host (key unchanged).
3. Live `greealitytv.com/` + `/blog` now emit `https://cdn.madladslab.com/...`, **0** Linode refs; sampled cdn URL resolves 200.

greeality's stored URLs are already cdn, so the bulk rewrite below is a **no-op** for it (idempotent — it only matches Linode URLs).

## What's pre-wired in /srv/slab (inert until env is set)
- `plugins/s3.js` — `bucketUrl()` returns `${CDN_BASE}/${key}` when `CDN_BASE` is set, else legacy Linode URL; client `forcePathStyle` driven by `S3_FORCE_PATH_STYLE`. With neither env set, behaviour is **identical to before** (verified).
- `scripts/rewrite-asset-urls.js <slug|--all> [--dry-run] [--revert]` — deep-walks every string in every doc (catches rich-text/HTML, not just url columns), pure host swap, idempotent, reversible.
- `bucketKey` (relative) fields are intentionally untouched.

---

## Cutover runbook (after operator does §3a + provides slab_rw)

### Step A — operator: bulk mirror on the GPU box (§3a of the surface handoff)
```powershell
& C:\OllamaCluster\bin\mc.exe alias set linode https://us-ord-1.linodeobjects.com <LINODE_KEY> <LINODE_SECRET>
& C:\OllamaCluster\bin\mc.exe mirror --overwrite linode/madladslab lm/madladslab
& C:\OllamaCluster\bin\mc.exe ls --recursive lm/madladslab | Measure-Object   # expect ~1487 objects, ~1.5GB
```
Linode bucket today: **1487 objects, ~1556 MB**. Top prefixes: madladslab(825), nocometalworkz(276), agent-generated(151), slab(108), w2marketing(75), mobilemeadows(20), greeality(6).

**Gate before Step C:** confirm a real object resolves on cdn, e.g.
`curl -I https://cdn.madladslab.com/madladslab/<some-existing-key>` → `200`.

### Step B — point the live app's WRITES at MinIO (env only, no code edit)
Edit `/srv/slab/.env` (exact var names the app reads):
```
LINODE_URL=http://127.0.0.1:9100        # MinIO via tunnel (server-side writes)
LINODE_REGION=us-east-1
LINODE_BUCKET=madladslab                 # unchanged
LINODE_ACCESS=slab_rw                    # scoped user (from C:\OllamaCluster\minio-slab.env)
LINODE_SECRET=<slab_rw secret>
S3_FORCE_PATH_STYLE=true                 # required for MinIO
CDN_BASE=https://cdn.madladslab.com      # public URL host for new uploads
```
(Keep the old Linode key/secret somewhere until decommission, for read-fallback/rollback.)

### Step C — rewrite stored URLs across all tenants, then restart
```bash
cd /srv/slab
node scripts/rewrite-asset-urls.js --all --dry-run     # review counts (~433+ docs across 5 active tenants)
node scripts/rewrite-asset-urls.js --all               # real
/srv/restart-service.sh slab                            # picks up env (B) + view caches
```

### Step D — verify, then decommission Linode
- New upload via the app → object appears under `lm/madladslab/...` and loads via cdn.
- Spot-check each tenant homepage: cdn refs present, 0 `linodeobjects.com` refs.
- Keep Linode as read fallback for a few days; then decommission the bucket/keys.

## Rollback (any time)
```bash
node scripts/rewrite-asset-urls.js --all --revert       # cdn → Linode in docs
# revert .env Step B (LINODE_* back to Linode, unset CDN_BASE + S3_FORCE_PATH_STYLE)
/srv/restart-service.sh slab
```
Objects still exist on Linode (mirror was additive), so reverting URLs fully restores the old path.

## Caveats / notes
- **Writes never traverse the public surface** — app writes server-side to `127.0.0.1:9100`; the cdn vhost stays GET/HEAD only.
- **Reboot survival + backups:** both the mongod (tenant DBs) and MinIO (objects) now hold production data on the GPU box. Confirm `OllamaMongo`/`OllamaBucket`/`OllamaClusterTunnel` scheduled tasks survive reboot, and add scheduled `mongodump` + a MinIO backup. (Same note as the DB + surface handoffs.)
- After full cutover, Linode Object Storage is no longer in the serving path — leaves **DNS + OAuth2** as the only remaining Linode/cloud dependencies (the endgame).

---
*Tooling: `scripts/rewrite-asset-urls.js`, `plugins/s3.js`, `config/config.js`. Surface details: `HANDOFF-s3-surface.md`. DB migration: `HANDOFF-tenant-db-migration.md`.*
