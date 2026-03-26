# Advanced Settings

## White-Label Google Login

By default, all tenants share the platform's Google OAuth app. Your users see "Slab" on Google's consent screen during sign-in.

To show **your brand name** instead, set up your own Google OAuth app:

### Setup Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Navigate to **APIs & Services > OAuth consent screen**
   - Set your **App name** to your business name
   - Upload your logo
   - Add your domain to authorized domains
4. Go to **Credentials > Create Credentials > OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: `https://yourdomain.com/auth/google/callback`
   - If you use both a subdomain and custom domain, add both:
     - `https://yourbrand.madladslab.com/auth/google/callback`
     - `https://yourdomain.com/auth/google/callback`
5. Copy the **Client ID** and **Client Secret**
6. In your admin panel, go to **Settings & Keys > Google OAuth**
7. Paste the Client ID and Client Secret
8. Save — the secret is encrypted at rest

### How It Works

When your OAuth credentials are configured:
- Login redirects through **your** Google app (your brand on the consent screen)
- The callback returns to **your** domain directly (no cross-domain redirect)
- If your credentials are removed, login falls back to the platform default

## Custom Domains

Your site runs on `yourbrand.madladslab.com` by default. To use your own domain (e.g. `yourdomain.com`):

### DNS Setup

Add an **A record** pointing to the platform server:

| Type | Name | Value |
|------|------|-------|
| A | `@` | `104.237.138.28` |
| A | `www` | `104.237.138.28` |

### Activation

Contact the platform administrator to:
1. Verify your DNS is pointing correctly
2. Generate the Apache virtual host configuration
3. Issue an SSL certificate via Let's Encrypt
4. Create the domain alias in the tenant registry

Once activated, both your subdomain and custom domain will serve the same site with the same data.

## Email Deliverability

If you send email through Zoho (invoices, campaigns, contact forms), proper DNS records prevent your messages from landing in spam.

### Required DNS Records

| Record | Purpose | Value |
|--------|---------|-------|
| **SPF** | Authorizes Zoho to send on your behalf | `v=spf1 include:zoho.com ~all` |
| **DKIM** | Cryptographic email signature | Get from Zoho Mail Admin > DKIM |
| **DMARC** | Tells receivers how to handle failures | `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com` |

### Checking Your Records

1. Go to **Settings & Keys**
2. Enter your Zoho email address
3. Click **Check DNS** — the system verifies SPF, DKIM, DMARC, and MX records
4. For `*.madladslab.com` subdomains, click **Auto-Create DNS** to set up SPF, DMARC, and return-path records automatically

### MX Records (Receiving Email)

If you want to **receive** email at your domain through Zoho:

| Priority | Server |
|----------|--------|
| 10 | `mx.zoho.com` |
| 20 | `mx2.zoho.com` |
| 50 | `mx3.zoho.com` |

## SSL Certificates

All `*.madladslab.com` subdomains are covered by a wildcard SSL certificate. Custom domains get individual certificates issued via Let's Encrypt, automatically renewed.

## Data Isolation

Each tenant's data is completely isolated:
- **Database** — Separate MongoDB database per tenant
- **Files** — Separate prefix in shared S3 bucket (files are never mixed)
- **Credentials** — Encrypted per-tenant, decrypted only in memory
- **Sessions** — Separate session collection per tenant database

No tenant can access another tenant's data through any route or API.

## Subscription Plans

| Plan | Duration | Expiry |
|------|----------|--------|
| Free | Preview only | No public access |
| Monthly | 30 days | Auto-renews via Stripe |
| Annual | 365 days | Auto-renews via Stripe |
| Lifetime | Forever | No expiry |

Plan management is handled by the platform superadmin. Status can be: `preview`, `active`, `suspended`, or `cancelled`.
