# MediaHasher

Landing page, accounts, PayPal/Stripe checkout, and license issuance & validation
for the **MediaHasher** Electron desktop app. The Electron app itself lives at
`/srv/media-hasher/desktop/` (TBD) and a shared core engine at
`/srv/media-hasher/core/` (TBD).

## Stack

- Node.js (ESM), Express, EJS
- MongoDB Atlas — own database `mediaHasher` (does **not** share `users` with other services; matches the existing pattern where each service owns its DB)
- Passport — Google OAuth (shared madladslab Google creds) + Local
- PayPal — primary payment processor (server-wide credentials)
- Stripe — optional, disabled if creds are missing
- Linode Object Storage — Electron installer hosting (bucket `madladslab`, prefix `mediahasher/installers/`)
- Zoho — license key emails

## Service info

| Key | Value |
|---|---|
| Path | `/srv/media-hasher` |
| Port | 3604 |
| Domain | `mediahasher.madladslab.com` |
| Tmux session | `media-hasher` |
| Database | `mediaHasher` |

## Collections

- `users` — accounts (Google OAuth + Local)
- `licenses` — license keys (`MH-XXXX-XXXX-XXXX-XXXX`), trial or lifetime
- `purchases` — every payment attempt (PayPal or Stripe), source of truth for money
- `download_tokens` — short-lived signed download grants (TTL index)
- `sessions` — express-session store

## Routes

| Path | Purpose |
|---|---|
| `GET  /` | Marketing home |
| `GET  /pricing` | Pricing & buy buttons |
| `GET  /auth/login` | Sign in / sign up |
| `POST /auth/login` | Local login |
| `POST /auth/signup` | Local signup |
| `GET  /auth/google` | Google OAuth start |
| `GET  /auth/google/callback` | Google OAuth callback |
| `POST /auth/logout` | Logout |
| `POST /trial/start` | Issue 7-day trial license |
| `POST /checkout/paypal/create` | Create PayPal order |
| `GET  /checkout/paypal/return` | PayPal capture & license issue |
| `POST /checkout/stripe/create` | Create Stripe Checkout session (optional) |
| `POST /webhooks/stripe` | Stripe webhook → license issue |
| `GET  /account` | License & purchase dashboard |
| `GET  /download` | Installer list (license-gated) |
| `GET  /download/file?key=...` | Signed Linode URL redirect |
| `GET  /api/license/lookup` | License info by key |
| `POST /api/license/activate` | Bind device, return JWT |
| `POST /api/license/heartbeat` | Periodic re-validation |
| `POST /api/license/deactivate` | Free a device slot |
| `GET  /healthz` | Health check |

## Setup

```bash
cd /srv/media-hasher
cp .env.example .env
# fill in DB_URL, GGLCID/GGLSEC, PAYPAL_CID/PAYPAL_SEC, LINODE_*, ZOHO_*, secrets
npm install
npm start
```

## TODO before going live

- [ ] Apache vhost + Let's Encrypt cert for `mediahasher.madladslab.com`
- [ ] Add to `/srv/auto-start-npm.json` and `/srv/start-all-services.sh`
- [ ] Add to `.claude-context.json` services registry
- [ ] First Electron build → upload to Linode `madladslab/mediahasher/installers/`
- [ ] Wire trial-expiry cron (email at T-1 day, mark expired licenses)
- [ ] Optional: legal pages (terms, privacy, refund policy)
