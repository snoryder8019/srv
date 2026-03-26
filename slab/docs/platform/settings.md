# Settings & Integrations

Access at `/admin/settings`. This is where you configure your business profile and connect external services.

## Business Profile

These fields power your website content and AI agent prompts:

| Field | What It Does |
|-------|-------------|
| **Business Name** | Displayed in header, footer, and AI context |
| **Business Type** | e.g. "Marketing Agency" — used by AI for tone |
| **Industry** | Helps AI generate relevant content |
| **Tagline** | Short brand statement |
| **Description** | Longer brand description for AI context |
| **Location** | Displayed in footer and contact section |
| **Service Area** | Geographic coverage |
| **Services** | Comma-separated list — shown in footer, used by AI |
| **Target Audience** | Helps AI tailor content |
| **Brand Voice** | e.g. "Professional, friendly" — guides AI writing style |
| **Social Links** | Facebook, Instagram, Twitter, LinkedIn, YouTube, TikTok |

## Payment Integrations

### Stripe
- **Publishable Key** — starts with `pk_live_` or `pk_test_`
- **Secret Key** — starts with `sk_live_` or `sk_test_` (encrypted at rest)
- **Webhook Secret** — from Stripe Dashboard > Webhooks (encrypted at rest)
- Use **Test Connection** to verify your keys work

### PayPal
- **Client ID** — from PayPal Developer Dashboard
- **Secret** — encrypted at rest
- **Mode** — `sandbox` for testing, `live` for production

## Email (Zoho)
- **Zoho User** — your sending email address (e.g. `you@yourdomain.com`)
- **Zoho Password** — app password, not your login password (encrypted at rest)
- Use **Test Connection** to verify SMTP works
- Use **Check DNS** to verify SPF, DKIM, DMARC records

## Google Services

### Places (Reviews)
- **API Key** — from Google Cloud Console > APIs > Places API
- **Place ID** — find yours at [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id)
- Reviews are cached for 24 hours

### OAuth (White-Label Login)
- See [Advanced Settings](advanced-settings.md) for white-label OAuth setup

## Security

All secret fields (marked with a lock icon) are encrypted with AES-256-GCM before storage. They are never logged, never exposed in templates, and only decrypted in memory when needed for API calls. Masked values (showing last 4 characters) are displayed in the settings form.
