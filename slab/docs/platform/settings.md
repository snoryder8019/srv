# Settings & Integrations

Access at `/admin/settings`. This is where you describe your business and connect the outside services your site uses. Settings is reserved for the workspace owner and unrestricted admins.

## Business Profile

These fields fill in your website and give the AI agents context about who you are.

| Field | What It Does |
|-------|-------------|
| **Business Name** | Header, footer, and AI context |
| **Business Type** | e.g. "Marketing Agency" — guides AI tone |
| **Industry** | Helps AI generate relevant content |
| **Tagline** | Short brand statement |
| **Description** | Longer brand description for AI context |
| **Location / Service Area** | Footer and contact section |
| **Phone / Email / Owner Name** | Contact details across the site |
| **Services** | Comma-separated list — shown in footer, used by AI |
| **Pricing Notes** | Context the AI uses when it talks about cost |
| **Target Audience** | Helps AI tailor content |
| **Brand Voice** | e.g. "Professional, friendly" — guides AI writing style |
| **Social Links** | Facebook, Instagram, X, LinkedIn, YouTube, TikTok |

## Payments

Choose which method invoices offer: Stripe, PayPal, or both.

### Stripe
- **Publishable Key** — starts with `pk_live_` or `pk_test_`
- **Secret Key** — starts with `sk_live_` or `sk_test_`
- **Webhook Secret** — from your Stripe dashboard
- **Test Connection** verifies your keys work

### PayPal
- **Client ID** and **Secret** from the PayPal Developer dashboard
- **Mode** — `sandbox` for testing, `live` for real payments

## Email

Pick your sending provider: Zoho, Gmail, Outlook, or a custom SMTP server.

- **Password mode** — enter your address plus an app password (not your normal login password)
- **Connect mode** — for Gmail and Outlook you can instead click Connect and authorize the mailbox; no password is stored
- **Custom SMTP** — supply your own host and port
- **Test Connection** sends a check through your settings
- **Check DNS** verifies your SPF, DKIM, DMARC and MX records — see [Advanced Settings](advanced-settings.md)

## Google Services

- **Places (Reviews)** — add an API key and your Place ID to show Google reviews on your site. Reviews are refreshed at most once every 24 hours.
- **Sign-in (white-label)** — use your own Google app so your brand appears on the consent screen. See [Advanced Settings](advanced-settings.md).
- **Drive & Photos import** — connect either account to pull images straight into your Asset library. Nothing to configure; the Connect button handles it.

## Microsoft Sign-In

You can also let your team sign in to the admin with a Microsoft work account, using your own Azure app. The redirect address to register is shown on the settings page.

## Custom API Keys

Beyond the built-in integrations above, you can store **your own API keys** for anything else you use. Go to **Settings → Custom API Keys → Manage API keys**.

- Give each key a name and paste the value; an optional note helps you remember what it's for
- Values are encrypted before they're saved and only decrypted when something needs to use them
- The list shows only the last four characters of each key
- Saving a key with an existing name replaces it; keys can be deleted at any time

One key name is special: store an **Anthropic API key** here and your AI agents will run on Claude instead of the shared house model. See [AI Agents](ai-agents.md).

## Slab Functions

Switch individual advanced tools on or off to keep your sidebar focused. This changes the menu only — not your data and not anyone's permissions. See [Admin Panel](admin-panel.md).

## Language

Multi-language support is per workspace and **off by default**. Nothing about your site changes until you turn it on.

The settings page has three controls:

| Control | What it does |
|---------|-------------|
| **Public site language** | The default language visitors see |
| **Admin / workspace language** | The default language you see in the dashboard — can differ from the public site |
| **Show language switcher** | Adds an EN / ES toggle to your public header and footer |

How it behaves:

- Supported languages today are **English** and **Spanish**
- With the switcher on, each visitor's choice is remembered as they browse
- Your admin choice and your visitors' choices are kept separate — switching the dashboard to Spanish does not change your public site
- The page's language tag updates too, so search engines and screen readers see the right language

### What is translated today

- **Translated** — public site framing: navigation, footer, sign-in, booking, payment and receipt pages, forms, legal pages, careers, marketplace, meetings, onboarding, and the In the Field module
- **Not translated** — most of the admin dashboard is still English; translation there is being rolled out module by module
- **Never auto-translated** — anything *you* write. Blog posts, page content, site copy, portfolio entries, product listings and emails are stored exactly as you enter them and are shown in whatever language you wrote them in, regardless of the visitor's choice.

If you want a genuinely bilingual site, plan to write the content twice.

## Security

Secret fields — payment secrets, email passwords, OAuth secrets, and your custom API keys — are encrypted before storage using AES-256-GCM. They are never logged, never sent to your website's pages, and are decrypted in memory only when a request needs them. The settings form shows masked values with the last four characters visible.
