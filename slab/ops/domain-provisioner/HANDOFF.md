# Domain Provisioner — Handoff

Auto-provisions Apache vhosts + Let's Encrypt certs for Slab tenant **custom
domains**, so nobody hand-edits `.conf` when a tenant saves domain settings.

## The problem it solves

Public Apache lives on the **VPS** (`104.237.138.28`). Node services + DB run on
the **Greeley box**, reachable from the VPS over the tunnel (Slab = `:3602`).
When a tenant saves a custom domain, Slab only writes `public.customDomain` in
Mongo — Apache never learns about it, so the domain falls through to the default
vhost (cards). This app closes that gap by **pulling** from Slab (the tunnel
only allows VPS→Greeley, so a push from Slab won't work).

```
tenant saves domain ──▶ Slab Mongo (public.customDomain)
                              │
        VPS provisioner  ─────┘  GET /internal/verified-domains (every 2 min)
              │
              ├─ certbot certonly --webroot   (HTTP-01, proves DNS points here)
              ├─ write tenant-<apex>.conf + a2ensite
              └─ apachectl configtest && systemctl reload apache2
```

## Slab side — already done (Greeley)

- `routes/internal.js` → `GET /internal/verified-domains` (paid, active tenants
  with a non-`madladslab.com` custom domain), guarded by `X-Provision-Key`.
- Mounted in `app.js` **before** `resolveTenant` (not tenant-scoped).
- `SLAB_PROVISION_KEY` set in `slab/.env`. **This is the shared secret** — copy
  it into the provisioner's `.env` (below). Rotate by changing both + restart.

Verify from the VPS (over the tunnel):
```bash
curl -s -H "X-Provision-Key: <KEY>" http://127.0.0.1:3602/internal/verified-domains | jq
```

## Quick install (recommended)

`install-on-vps.sh` is self-contained — it embeds the app, templates, ACME
catch-all, `.env`, and systemd unit. Copy that ONE file to the VPS and run it:

```bash
scp install-on-vps.sh root@104.237.138.28:/root/     # or paste it in
ssh root@104.237.138.28 'sudo bash /root/install-on-vps.sh'
```

It installs everything, scopes the first rollout to `guaranteedlandscaper.com`
(`ONLY_DOMAINS`), starts in `DRY_RUN`, and prints the exact commands to go live
and then widen to all domains. Nothing changes until you flip `DRY_RUN=`.

The manual steps below are the same thing broken out, if you prefer.

## VPS side — one-time install (manual)

Prereqs (once):
```bash
# Apache modules
a2enmod ssl proxy proxy_http proxy_wstunnel rewrite headers
# certbot
apt-get install -y certbot
# shared ACME webroot
mkdir -p /var/www/acme/.well-known/acme-challenge && chown -R www-data: /var/www/acme
```

Install the ACME catch-all vhost (answers the first challenge before a domain
has its own vhost). It sorts first (`000-`) so it's also the default `:80`:
```bash
cp apache/000-acme-catchall.conf /etc/apache2/sites-available/
a2ensite 000-acme-catchall && systemctl reload apache2
```

Deploy the app:
```bash
mkdir -p /opt/domain-provisioner
cp -r provisioner.mjs templates /opt/domain-provisioner/
cp .env.example /opt/domain-provisioner/.env
# edit /opt/domain-provisioner/.env:
#   SLAB_PROVISION_KEY = (copy from slab/.env)
#   CERTBOT_EMAIL      = admin@madladslab.com
#   EXPECTED_IP        = 104.237.138.28
```

**First run — dry, to see the plan without touching anything:**
```bash
cd /opt/domain-provisioner
set -a; . ./.env; set +a
RUN_ONCE=1 DRY_RUN=1 node provisioner.mjs
```

Then live as a service:
```bash
cp srv-domainprov.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now srv-domainprov
journalctl -u srv-domainprov -f
```

## What each new tenant needs (the only manual step left)

1. Tenant (or you) points DNS at the VPS:
   `A  @   104.237.138.28` and `A  www  104.237.138.28`.
2. Tenant saves the domain in `/admin/settings` (paid plan required).

Within one poll cycle (~2 min) the provisioner issues the cert and writes the
vhost. If DNS isn't pointed yet, it logs `does not resolve … skipping` and
retries every cycle — no error, no dead vhost.

## Unblock `guarunteedlandscaper.com` right now

It's already in the verified list (tenant *GUARANTEED LANDSCAPING LLC*, plan
`monthly`) but **its DNS does not resolve yet** (`NXDOMAIN`). Nothing — manual
or automated — can get a cert until DNS points at the VPS. So:

1. Add `A @ 104.237.138.28` + `A www 104.237.138.28` at the registrar.
2. Once it resolves, either wait for the service, or force one cycle:
   ```bash
   cd /opt/domain-provisioner && set -a; . ./.env; set +a; RUN_ONCE=1 node provisioner.mjs
   ```
> Note the spelling saved in Slab is **`guarunteedlandscaper.com`** (with a *u*).
> Confirm that's the real registered domain — if the tenant meant
> `guaranteedlandscaper.com`, fix it in `/admin/settings` first, or the cert
> will be issued for the wrong name.

## Design notes / gotchas

- **Routing is by cert, not alias.** Each domain gets its own `:443` vhost that
  `ProxyPreserveHost`s to the tunnel; Slab resolves the tenant by Host. No edits
  to the shared slab vhost ever again.
- **Paid-only.** Mirrors the settings-page gate. Legacy free domains still in
  the old `ServerAlias` (`greealitytv.com`, `nocometalworkz.com`) are **not**
  managed here and keep working via the existing slab vhost — untouched.
- **www fallback.** If `www` doesn't resolve, the cert is issued apex-only
  rather than failing the whole request.
- **Renewals** are handled by the system `certbot.timer`, not this app. Add an
  Apache reload deploy-hook so renewed certs take effect:
  `/etc/letsencrypt/renewal-hooks/deploy/reload-apache.sh` → `systemctl reload apache2`.
- **PRUNE=1** (opt-in) `a2dissite`s vhosts for domains no longer verified
  (tenant downgraded/removed the domain). Off by default for safety.
- **Idempotent.** Re-runs are cheap: skips domains that already have cert+conf.
- **Ownership proof.** HTTP-01 only succeeds if DNS already points at the VPS,
  so issuance itself is the verification — no separate DNS-TXT step.
