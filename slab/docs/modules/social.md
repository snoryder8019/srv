# Social Media Portal

`/admin/social` — compose, schedule, and cross-post to social platforms from one panel, then export the post log.

---

## Architecture

| Piece | File |
|-------|------|
| Routes | `routes/admin/social.js` (mounted `/admin/social` in `routes/admin.js`) |
| Platform registry + publish adapters | `plugins/socialPublish.js` |
| Scheduler cron | `plugins/socialCron.js` (started in `bin/www.js`, runs every minute) |
| View | `views/admin/social/index.ejs` |

### Data model (tenant DB — `req.db`)

- **`social_accounts`** — one doc per platform: `{ platform, enabled, label, credentials:{...public}, secrets:{...encrypted}, connectedAt, lastTestOk, lastTestAt }`. Secret fields are AES-256-GCM encrypted via `plugins/crypto.js` (`encrypt`/`decrypt`) before storage and are never returned to the browser — only a masked hint and a "set" boolean (`maskAccount()`).
- **`social_posts`** — `{ body, link, mediaUrls[], platforms[], status, scheduledAt, publishedAt, results[], createdBy, createdAt }`. Status: `draft → scheduled → publishing → published | partial | failed`.

### Publishing flow

1. **Now** — POST `/social/posts` with `action=publish` → `publishPost()` fans out to each platform's adapter.
2. **Scheduled** — `action=schedule` stores `status:'scheduled'` + `scheduledAt`. The cron claims due posts (atomic `scheduled→publishing` update to avoid double-send) and publishes them.
3. Each adapter returns `{ ok, id, url, error }`, recorded per-platform in `results[]`.

---

## Two places to manage credentials (one store)

Both surfaces read/write the same `social_accounts` collection — no duplication:

1. **Settings → Social Media** (`/admin/settings`) — every platform listed alongside Stripe/PayPal/Zoho, each with an **Input keys** button, a **dev-portal link**, and two status checks: **Entered** (keys saved) and **Verified** (live connection confirmed). Save + Verify are AJAX against the endpoints below.
2. **Social portal → Connections** (`/admin/social?tab=connections`) — the same forms in the portal context.

**Verify** calls a real **read-only** API check per platform (`verify()` adapters in `socialPublish.js` → `verifyPlatform()`), e.g. Graph `GET /{pageId}` for Facebook, `verify_credentials` for Mastodon, `getMe`+`getChat` for Telegram, `users/me` for X. It posts nothing. `lastTestOk` is stored and drives the green Verified check.

## Platform setup — what each account/key needs

Secret fields show a masked hint once saved; leave blank to keep the existing value.

### ✅ Live (manual token — works today)

| Platform | Account needed | Fields to enter | Where to get them |
|----------|----------------|-----------------|-------------------|
| **Mastodon** 🐘 | Any Mastodon account | Instance URL, Access Token | Instance → Preferences → Development → New Application (`write:statuses`, `write:media`) → copy access token |
| **Bluesky** 🦋 | Bluesky account | Handle, App Password | App → Settings → Privacy & security → App Passwords. Use the **app password**, not your login |
| **Discord** 💬 | A server you manage | Webhook URL | Channel → Edit → Integrations → Webhooks → New Webhook → Copy URL |
| **Telegram** ✈️ | A bot + channel | Bot Token, Chat/Channel ID | @BotFather → `/newbot`. Add bot as channel admin; use `@channel` or numeric id |
| **Facebook Page** 📘 | Meta Developer app + a Page | Page ID, Page Access Token | developers.facebook.com app with Pages product; long-lived Page token (`pages_manage_posts`, `pages_read_engagement`) |
| **Instagram** 📷 | IG Business/Creator linked to a FB Page | IG User ID, Access Token | Same Meta app + Instagram Graph API (`instagram_content_publish`). **Posts require a public image URL** |
| **LinkedIn** 💼 | LinkedIn Developer app | Author URN, Access Token | linkedin.com/developers, "Share on LinkedIn" product; OAuth2 token (`w_member_social`); URN = `urn:li:person:{id}` or `urn:li:organization:{id}` |
| **X (Twitter)** 𝕏 | **Paid** Developer account (~$100/mo Basic) | OAuth2 Access Token | developer.x.com → project/app → OAuth2 (`tweet.write tweet.read users.read offline.access`) → user token |

> **Token lifetimes:** LinkedIn member tokens (~60d) and X user tokens (short-lived) expire. When a publish fails with a 401, re-paste a fresh token under Connections. Facebook/Instagram should use **long-lived** Page tokens.

### 🕓 Roadmap (registered, publishing not yet wired)

**Threads** (Meta Threads API), **YouTube** (Google Cloud + YouTube Data API v3, video upload), **TikTok** (Content Posting API, requires app review), **Pinterest** (OAuth2 `pins:write`). These appear in Connections with their setup notes but currently return "not available yet" on publish.

---

## Legal & compliance (Privacy Policy + Data Deletion)

Meta and other platforms require a **Privacy Policy URL** and a **Data Deletion callback** to approve an app. Every tenant gets these automatically at stable URLs (resolved per tenant domain):

| URL | What |
|-----|------|
| `https://<domain>/privacy` | Privacy policy. Default rendered from `views/legal/privacy.ejs`; a tenant can override via the `copy` doc `privacy_content` (then `views/legal/custom.ejs` renders it). |
| `https://<domain>/terms` | Terms (same pattern, `terms_content`). |
| `https://<domain>/data-deletion` | **Meta callback (POST)** + **user status/instructions page (GET)**. |

These are surfaced with copy buttons in **Settings → Social Media** and the Social portal's **Compliance** tab.

### Data deletion flow (`routes/index.js`)
- **POST `/data-deletion`** — Meta's callback. Body has `signed_request`. We parse it and, if the tenant saved their **Facebook App Secret** (optional field on the Facebook connection), verify the HMAC-SHA256 signature (`parseSignedRequest`). We insert a `deletion_requests` doc and respond with the required JSON `{ url, confirmation_code }`. Unsigned/unverifiable requests are still recorded (flagged `verified:false`) so Meta always gets a valid response.
- **GET `/data-deletion?code=...`** — user-facing status page for a confirmation code.
- **GET `/data-deletion`** (no code) — instructions + a manual email-based deletion request form (doubles as Meta's "Data Deletion Instructions URL").
- **POST `/data-deletion/request`** — manual (non-Meta) request; records `source:'manual'` with the email.

`deletion_requests` (tenant DB): `{ code, source:'meta'|'manual', platform, externalUserId, email, verified, status:'received'|'completed', createdAt, completedAt }`. Admins process them in the Social portal → **Compliance** tab (Mark done → `POST /admin/social/deletion/:id/complete`).

> The Facebook connection has optional **App ID** + **App Secret** fields (ignored by `isAccountConfigured`). The App Secret is only used to verify deletion callbacks; without it, callbacks still work but are marked unverified.

## Notes & limits

- **Test button** — for Discord/Telegram it posts a real connection-confirmation message; for the others it only validates that credentials are present (a real post is the true test).
- **Media** — images are passed as public URLs. Instagram and (future) Pinterest **require** an image. Use an Asset Manager URL or any public image link.
- **X character limit** — the composer flags posts over 280 chars so cross-posts stay within X's limit.
- **Export** — `GET /social/export?format=csv|json` downloads the full post log.
- **Encryption** — requires `MASTER_KEY` (64-char hex) in env, same key used by Settings secrets.
