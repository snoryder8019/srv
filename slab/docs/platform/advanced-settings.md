# Advanced Settings

Optional setup for businesses that want their own domain, their own branding on the sign-in screen, and reliable email delivery.

## White-Label Sign-In

By default every workspace shares the platform's Google app, so your team sees "Slab" on Google's consent screen when they sign in. You can put **your** brand there instead by registering your own app.

### Google

1. Go to the Google Cloud Console and create a project
2. Under **APIs & Services → OAuth consent screen**, set your app name to your business name and upload your logo
3. Under **Credentials**, create an **OAuth 2.0 Client ID** of type *Web application*
4. Add your sign-in redirect address. If you use both a subdomain and a custom domain, add both:
   - `https://yourbrand.madladslab.com/auth/google/callback`
   - `https://yourdomain.com/auth/google/callback`
5. Copy the Client ID and Client Secret into **Settings & Keys → Google OAuth** and save

Once saved, sign-in runs through your app and returns straight to your domain. Remove the credentials and it falls back to the platform default — nobody gets locked out.

### Microsoft

The same is available for Microsoft work accounts. Register an app in Azure, then paste the Client ID, Secret, and directory setting into Settings. The exact redirect address to register is displayed on the settings page — copy it from there rather than typing it.

## Custom Domains

Your site runs on `yourbrand.madladslab.com` out of the box. To serve it from your own domain instead:

1. Point your domain at the platform with **A records** for both `@` and `www` — the target address is shown on your settings page
2. Ask the platform team to activate it

Activation is a manual step on our side: we confirm your DNS has propagated, add the web server configuration, issue your certificate, and register the domain against your workspace. After that, your subdomain and your custom domain serve the same site and the same data.

## SSL Certificates

Every `*.madladslab.com` subdomain is covered by a wildcard certificate. Custom domains get their own certificate, renewed automatically. There is nothing for you to install or renew.

## Email Deliverability

If you send invoices, campaigns or form notifications from your own address, your domain needs the right DNS records or your mail will land in spam.

| Record | Purpose |
|--------|---------|
| **SPF** | Authorizes your provider to send on your behalf |
| **DKIM** | Cryptographic signature proving the message wasn't tampered with |
| **DMARC** | Tells receiving servers what to do when a check fails |
| **MX** | Required only if you also want to *receive* mail at the domain |

### Checking and fixing your records

1. Go to **Settings & Keys** and make sure your sending address is filled in
2. Click **Check DNS** — you get a per-record pass or fail with the exact value expected
3. If your site is on a `*.madladslab.com` subdomain, click **Auto-Create DNS** and the SPF, DMARC and return-path records are created for you
4. On a custom domain, add the values shown at your own DNS provider, then re-run the check

DKIM always has to be generated in your mail provider's admin console and pasted into DNS — it can't be created for you.

## Need a Hand Wiring Things Up?

If connecting accounts is not how you want to spend your afternoon, the settings page has a **setup request** form. Tell us which accounts you need connected and add any detail, and the platform team picks it up and gets in touch. It's the fastest path when you're stuck on DNS or OAuth.

## Data Isolation

Each workspace is separated from every other one:

- **Database** — your own database, not a shared table with a tenant column
- **Files** — your own storage area; uploads are never mixed with another business's
- **Credentials** — encrypted per workspace and decrypted only in memory, at the moment they're used
- **Sessions** — stored inside your own database

There is no route or API through which one workspace can read another's data.

## Plans & Status

Plan pricing is covered in [Overview](overview.md). Every plan unlocks a fixed number of days of live access:

| Plan | Access granted |
|------|----------------|
| Free Trial | 14 days, once per workspace |
| Monthly | 30 days |
| Quarterly | 90 days |
| Annual | 365 days |

Your workspace also carries a status. **Preview** means you can build and see everything privately but the public site isn't served yet. **Active** means you're live. **Suspended** and **cancelled** are set by the platform team.

Building your site before you pay is expected — the intended order is *build, then start the trial, then go live, then add your domain*.
