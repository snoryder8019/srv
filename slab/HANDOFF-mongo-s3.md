# Handoff — Mongo + S3 over the madladslab tunnel

**Generated:** 2026-06-27 · **Box:** DESKTOP-2VRPOAO (GPU cluster) → VPS `104.237.138.28` (madladslab.com)
**Audience:** the slab / VPS-side dev work that needs to write tenant DBs + objects.

> Secrets are live credentials. Keep this file private. Rotate by re-running the
> bootstrap scripts noted at the bottom; the tunnel and tasks pick up changes on restart.

---

## 1. How the connection reaches you

The Windows GPU box runs an **SSH reverse tunnel** (`OllamaClusterTunnel` task →
`C:\OllamaCluster\tunnel.bat`) into the VPS. The VPS sshd has `GatewayPorts no`, so
every forwarded port is **loopback-only on the VPS** — reachable from the VPS shell
(and from anything SSH-ing into the VPS), never from the public internet.

| Service        | VPS loopback (use this) | Origin on Windows box |
|----------------|-------------------------|-----------------------|
| MongoDB        | `127.0.0.1:27117`       | `127.0.0.1:27017`     |
| S3 / MinIO API | `127.0.0.1:9100`        | `127.0.0.1:9000`      |
| S3 console (UI)| `127.0.0.1:9101`        | `127.0.0.1:9001`      |

> Mongo deliberately rides a **non-default** VPS port (27117, not 27017) so a port
> scan of the VPS loopback doesn't announce "mongo here."

**Tunnel auth / "the sha keys":** the box authenticates to the VPS with this key —
verify it in `/root/.ssh/authorized_keys` on the VPS:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILm4p9CkSbv4ILUzAPRxY4Slu7pcqmrq3ClwuP99NUis snory@LAPTOP-NHKLS8LD
SHA256:SY2iUZKn+6yBz5LAyUUiGcSyLNuOBQaWxf7uYSnQamI   (ED25519)
```

**From a laptop that is NOT the VPS** — hop through the VPS to pull a port local:
```bash
ssh -L 27117:127.0.0.1:27117 -L 9100:127.0.0.1:9100 root@104.237.138.28
# then connect to 127.0.0.1:27117 / 127.0.0.1:9100 on the laptop
```

---

## 2. MongoDB — tenant credentials

Scoped, **non-root** app user. Role `readWriteAnyDatabase`:
- ✅ create databases, create collections, read/write documents (the tenant work)
- ✅ drop collections
- ❌ drop whole databases, manage users, shut down the server, touch admin/local/config
- Root (`madlab-admin`) is **never** exposed off-box — it stays in `mongo.env` on Windows.

**Connection string (from the VPS):**
```
mongodb://tenant_app:yiRXU0MPf0VNaLKmWrbDK5lAm9MhDq9xW1QjBvu@127.0.0.1:27117/?authSource=admin
```

User / password (if you build the URI yourself):
```
user: tenant_app
pass: yiRXU0MPf0VNaLKmWrbDK5lAm9MhDq9xW1QjBvu
authSource: admin
```

**Node (mongodb driver):**
```js
import { MongoClient } from 'mongodb';
const uri = 'mongodb://tenant_app:yiRXU0MPf0VNaLKmWrbDK5lAm9MhDq9xW1QjBvu@127.0.0.1:27117/?authSource=admin';
const client = new MongoClient(uri);
await client.connect();
const db = client.db('tenant_acme');               // a tenant = a database
await db.collection('users').insertOne({ name: 'Ada' });
```

**mongosh:**
```bash
mongosh "mongodb://tenant_app:yiRXU0MPf0VNaLKmWrbDK5lAm9MhDq9xW1QjBvu@127.0.0.1:27117/?authSource=admin"
```

Convention: **one database per tenant** (`tenant_<slug>`), collections inside it.
The app user can create these on first write — no admin step needed per tenant.

---

## 3. S3 / MinIO — object storage

S3-compatible. Data lives on the 8 TB G: drive (`G:\Application_Data\minio\data`).
These are the **root** MinIO creds (no scoped user minted yet — see note):

```
Endpoint (S3 API):  http://127.0.0.1:9100
Console (web UI):   http://127.0.0.1:9101
Access key:         madlab-772d1f66e0b1
Secret key:         weZrpZHzA0LLUIFj14iUjhLfriBshKl0OVkHWPrs
Region:             us-east-1   (MinIO default; any value works)
```

**AWS CLI:**
```bash
aws --endpoint-url http://127.0.0.1:9100 \
    --region us-east-1 \
    s3 mb s3://tenant-acme
aws --endpoint-url http://127.0.0.1:9100 s3 cp ./file.png s3://tenant-acme/
```

**Node (AWS SDK v3):**
```js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:9100',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'madlab-772d1f66e0b1', secretAccessKey: 'weZrpZHzA0LLUIFj14iUjhLfriBshKl0OVkHWPrs' },
});
await s3.send(new PutObjectCommand({ Bucket: 'tenant-acme', Key: 'file.png', Body: buf }));
```

> **Note:** these are root keys. When you want least-privilege for the slab, say the
> word and I'll mint a scoped MinIO user (`mc admin user add` + a per-prefix policy)
> the same way mongo got `tenant_app`.

---

## 4. Quick health checks

```bash
# On the VPS:
nc -z 127.0.0.1 27117 && echo "mongo port open"
curl -s http://127.0.0.1:9100/minio/health/live -o /dev/null -w "minio: %{http_code}\n"
```

---

## 5. Where things live on the Windows box (for the operator, not the slab)

| Thing | Path / name |
|-------|-------------|
| Mongo launcher | `C:\OllamaCluster\mongo.ps1` (task `OllamaMongo`) |
| Mongo data | `G:\Application_Data\mongo\data` (migrated off C: on 2026-06-27) |
| Mongo root creds | `C:\OllamaCluster\mongo.env` (on-box only) |
| Mongo tenant creds | `C:\OllamaCluster\mongo-tenant.env` |
| Tenant user bootstrap | `node C:\OllamaCluster\bootstrap-mongo-tenant.mjs` (idempotent) |
| MinIO launcher | `C:\OllamaCluster\minio.ps1` (task `OllamaBucket`), creds `minio.env` |
| Tunnel | `C:\OllamaCluster\tunnel.bat` (task `OllamaClusterTunnel`), log `tunnel.log` |
