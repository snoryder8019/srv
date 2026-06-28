# Handoff — Slab tenant DBs moved onto the OllamaCluster mongod

**Date:** 2026-06-27
**From:** VPS `104.237.138.28` (slab.madladslab.com, /srv/slab)
**To:** the OllamaCluster / GPU box operator (DESKTOP-2VRPOAO)
**Why:** Atlas shared-tier hit its **500-collection cap** at signup. All Slab tenant
databases now live on the **self-hosted mongod on the GPU box**, reached over the
existing SSH reverse tunnel. Atlas now holds only the `slab` registry (+ dormant
fallback copies).

---

## 1. What changed

- New tenants **and** all existing tenants now read/write the GPU-box mongod
  (`mongod 8.0.5`, data at `G:\Application_Data\mongo\data`).
- VPS reaches it on loopback **`127.0.0.1:27117`** (scoped user `tenant_app`).
  Creds live in `/srv/slab/.env` (`TENANT_DB_URL`) and `C:\OllamaCluster\mongo-tenant.env`
  — not repeated here (keep them out of email).
- Slab routes per-tenant via a `dbHost` field on each `slab.tenants` registry doc
  (`gpu` | `atlas`) and an in-memory map loaded at boot. Code: `plugins/mongo.js`,
  `plugins/provision.js`, `middleware/tenant.js`.
- New signups default to `gpu` (`NEW_TENANT_DB_HOST=gpu`), with automatic fallback
  to Atlas if the tunnel is down at signup time, so signups never hard-fail.

## 2. Tenants migrated (all verified, HTTP 200, Atlas copy kept as fallback)

| Tenant db | docs |
|---|---|
| slab_greeality | 475 |
| slab_w2marketing | 985 |
| slab_slab (platform) | 853 |
| slab_madladslab | 1512 |
| slab_nocometalworkz | 1296 |
| slab_mobilemeadows | 13 |
| slab_argento (suspended) | 0 |
| slab_lawrie-wallace | 132 |
| slab_greenley | 183 |

12 registry docs on gpu (9 DBs + 3 custom-domain aliases).

## 3. ⚠️ ACTION REQUIRED on the GPU box — reboot survival

All tenant data now depends on the GPU box. If it reboots and the mongod or tunnel
do not auto-start, **every Slab site loses its database.** Per the cluster handoff,
the `OllamaMongo` and `OllamaClusterTunnel` tasks needed a one-time admin (UAC)
install to survive reboot. **Confirm these are installed as scheduled tasks:**

- Mongo launcher: `C:\OllamaCluster\mongo.ps1` (task `OllamaMongo`)
- Tunnel: `C:\OllamaCluster\tunnel.bat` (task `OllamaClusterTunnel`)
- Install scripts: `C:\OllamaCluster\install-mongo-task.ps1`

Also worth adding: **automated backups** of `G:\Application_Data\mongo\data`
(mongodump on a schedule) now that it holds production tenant data.

## 4. Quick health checks (run on the VPS)

```bash
nc -z 127.0.0.1 27117 && echo "mongo tunnel open"
cd /srv/slab && node scripts/migrate-tenant-db.js <slug> --no-flip   # re-verify a tenant copy
# slab boot log should show: "tenant host map loaded — 12 on gpu" + "Tenant MongoDB connected"
```

## 5. Operating notes

- **Migrate another tenant:** `node scripts/migrate-tenant-db.js <slug> [--force]`
  (non-destructive copy + verify counts/indexes, then flips `dbHost`). **Restart
  slab after** so the running process reloads its host map (`/srv/restart-service.sh slab`).
- **Revert a tenant to Atlas:** set its `slab.tenants.dbHost` back to `atlas`,
  restart slab. The Atlas copy was left intact.
- **Restart is the cutover:** flipping `dbHost` alone won't move the running
  process — the boot-time map + ~80 non-request callers (login, crons) need the reload.

## 6. NOT done yet — bucket/object storage (images + video)

- Asset URLs in tenant docs are **absolute Linode Object Storage URLs**
  (`https://madladslab.us-ord-1.linodeobjects.com/<prefix>/...`) plus a relative
  `bucketKey`. The DB migration did **not** touch them — images/video still load
  from Linode and work fine.
- Self-hosted MinIO exists on the GPU box (VPS loopback `127.0.0.1:9100`,
  data `G:\Application_Data\minio\data`) but is **loopback-only**. Real blocker:
  expose it publicly (e.g. a `cdn.madladslab.com` vhost with public-read) **before**
  copying objects + rewriting the `publicUrl` fields in the DB. Small data; the
  endpoint is the hard part. (Operator is handling the exposed-S3 side.)

## 7. Endgame

Move all of `/srv` onto the GPU box; keep Linode for **DNS + OAuth2 only** as the
last cloud dependency. This DB split is step 1; object storage is step 2.

---
*Reference: full tunnel/creds in `/srv/slab/HANDOFF-mongo-s3.md`. Code in `/srv/slab`.*
