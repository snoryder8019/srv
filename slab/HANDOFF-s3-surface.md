# Handoff — Public S3/CDN surface for MinIO (step 1 of object-storage migration)

**Date:** 2026-06-27
**Built by:** GPU-box operator. Pairs with `HANDOFF-tenant-db-migration.md` §6.
**Status:** ✅ Public read surface is LIVE and verified. Object copy + DB URL rewrite (step 2) NOT done — see below.

---

## 1. What is live now

`https://cdn.madladslab.com/{key}` serves objects from the self-hosted MinIO bucket
`madladslab`, read-only, over the existing SSH reverse tunnel.

Verified end-to-end (external):
- `GET https://cdn.madladslab.com/_healthcheck/ping.txt` → `200` `cdn ok`
- `PUT` (any write) → `403` refused at the Apache edge
- TLS: cdn serves `CN=cdn.madladslab.com`; `*.madladslab.com` tenants still serve the wildcard cert (unaffected).

**Request path:** internet → Apache `cdn.madladslab.com:443` (TLS, GET/HEAD only) →
`127.0.0.1:9100` (SSH tunnel) → MinIO `127.0.0.1:9000` on the GPU box → bucket `madladslab`.

The URL is **clean / host-swappable**: the key after the host is identical to the
current Linode key, so the DB rewrite is just a hostname change.

| | Old (Linode) | New (cdn) |
|---|---|---|
| Example | `https://madladslab.us-ord-1.linodeobjects.com/acme/portfolio/171-x.jpg` | `https://cdn.madladslab.com/acme/portfolio/171-x.jpg` |

## 2. Pieces stood up

**On the GPU box (Windows):**
- MinIO bucket `madladslab`, anonymous policy = `download` (public read only).
- Scoped write user `slab_rw` (policy `slab-rw`: GetObject/PutObject/DeleteObject + ListBucket on `madladslab` only — no admin, no other buckets). Creds: `C:\OllamaCluster\minio-slab.env`.
- `mc` client at `C:\OllamaCluster\bin\mc.exe`, alias `lm` → `http://127.0.0.1:9000`.
- Permanent health object: `madladslab/_healthcheck/ping.txt`.

**On the VPS (Apache):**
- `/etc/apache2/sites-available/cdn.madladslab.com.conf` (:80, redirects to https; ACME exclusion).
- `/etc/apache2/sites-available/cdn.madladslab.com-le-ssl.conf` (:443, proxy + read-only `<LimitExcept GET HEAD>`).
- Cert `cdn.madladslab.com` (Let's Encrypt, apache HTTP-01). Renewal `installer = None` so renew never rewrites other vhosts.
- ⚠️ Fixed during setup: certbot had wrongly swapped the `*.madladslab.com` wildcard vhost's cert to the cdn cert; restored to `madladslab.com-0001`. Backup at `slab-wildcard-le-ssl.conf.bak.before-cdn`.

## 3. Step 2 — slab cutover (NOT done yet)

### 3a. Copy existing objects Linode → MinIO (keys preserved, non-destructive)
Run on the GPU box (writes are local = fast; Linode read over internet):
```powershell
# Linode creds come from slab config (LINODE_KEY / LINODE_SECRET)
& C:\OllamaCluster\bin\mc.exe alias set linode https://us-ord-1.linodeobjects.com <LINODE_KEY> <LINODE_SECRET>
& C:\OllamaCluster\bin\mc.exe mirror --overwrite linode/madladslab lm/madladslab
& C:\OllamaCluster\bin\mc.exe ls --recursive lm/madladslab | Measure-Object   # sanity count vs linode
```

### 3b. Point slab at MinIO (`/srv/slab`)
`plugins/s3.js` reads `config.LINODE_*`. Switch those values (env) + two code lines:
```
LINODE_ENDPOINT = http://127.0.0.1:9100      # MinIO via tunnel (server-side writes)
LINODE_REGION   = us-east-1
LINODE_BUCKET   = madladslab                  # unchanged
LINODE_KEY      = slab_rw                      # scoped user
LINODE_SECRET   = <from minio-slab.env>
```
Code edits in `plugins/s3.js`:
- `forcePathStyle: true`  (MinIO path-style)
- `bucketUrl(key)` → `` return `https://cdn.madladslab.com/${key}`; ``
- `ACL: 'public-read'` on PutObject is fine (MinIO accepts it; the bucket policy already makes reads public).

### 3c. Rewrite stored URLs in tenant docs
Replace the host prefix across all tenant DBs (key path is unchanged):
`https://madladslab.us-ord-1.linodeobjects.com/`  →  `https://cdn.madladslab.com/`
Mirror the existing `scripts/migrate-tenant-db.js` style; restart slab after (boot-time reload).

### 3d. Verify, then stop writing to Linode
- New upload → confirm object appears under `lm/madladslab/...` and loads via `https://cdn.madladslab.com/...`.
- Keep Linode as read fallback until URL rewrite is confirmed across tenants, then decommission.

## 4. Notes / decisions deferred
- **Cloudflare:** `cdn.madladslab.com` is currently DNS-only (direct to VPS). For media bandwidth/caching you *could* flip it to CF-proxied (orange cloud) later — origin already sends `Cache-Control: public, max-age=86400`. Not required for correctness.
- **Writes never traverse the public surface** — they go server-side to `127.0.0.1:9100`. Keep it that way; the public vhost stays GET/HEAD only.
- All depends on the GPU box + tunnel staying up (same reboot-survival note as the DB handoff). Consider scheduled `mongodump` + a MinIO backup now that both hold production data.
