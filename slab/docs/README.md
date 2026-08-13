# Slab Documentation

Tenant-facing guides. These render in-app at `/admin/docs` — the nav there is
built from the `CATEGORIES` list in `routes/admin/docs.js`, so **a new doc must
be added to both this index and that list** or it won't be reachable.

## Getting Started
- [Overview](platform/overview.md) — What Slab is, plans and pricing, how it works
- [Admin Panel](platform/admin-panel.md) — Dashboard, navigation, feature stages, Labs, permissions

## Platform
- [Settings & Integrations](platform/settings.md) — Business profile, API keys, email, payments, language
- [Advanced Settings](platform/advanced-settings.md) — White-label login, custom domains, DNS, deliverability
- [AI Agents](platform/ai-agents.md) — How the AI assistant works across modules

## Content
- [Pages](modules/pages.md) — Custom pages built from content blocks
- [Blog](modules/blog.md) — Create and manage blog posts
- [Portfolio](modules/portfolio.md) — Showcase your work
- [Marketplace](modules/marketplace.md) — List and sell items
- [Design & Theming](modules/design.md) — Colors, fonts, canvas editor, templates, themes
- [Site Copy](modules/copy.md) — Edit landing page text
- [Sections](modules/sections.md) — Custom landing page sections
- [Assets](modules/assets.md) — File library, media, and account resources
- [Careers](modules/careers.md) — Job postings and applications *(experimental)*

## Clients & CRM
- [Inquiries](modules/inquiries.md) — Contact-form inbox, spam handling, converting leads
- [Clients](modules/clients.md) — Client records, notes, quotes, and email
- [Onboarding](modules/onboarding.md) — Client intake forms and questionnaires
- [Help Requests](modules/tickets.md) — Raise and track support tickets
- [In the Field](modules/field.md) — Mobile field ops, dispatch, GPS, client link *(experimental)*

## Meetings
- [Meetings](modules/meetings.md) — Video meetings, recording, and AI notes
- [Notes](modules/notes.md) — Capture notes and route them to clients

## Marketing
- [Email Marketing](modules/email-marketing.md) — Campaigns, contacts, tracking
- [Social Media](modules/social.md) — Posting, scheduling, insights, Instagram grid mural
- [Live Studio](modules/live-studio.md) — Live streaming *(experimental)*
- [QR Codes & Card](modules/qr-codes.md) — QR codes and your digital business card
- [Print Studio](modules/print-studio.md) — Print-ready designs

## Finance
- [Bookkeeping](modules/bookkeeping.md) — Invoices, payments, receipts, refunds
- [Ledger & P&L](modules/ledger.md) — Accounts, transactions, bank statements, P&L
- [Calculators](modules/calculators.md) — Embeddable pricing calculators
- [Analytics](modules/analytics.md) — Traffic, revenue, and social metrics

## Admin
- [Users, Roles & Permissions](modules/users.md) — Team members, roles, and access

---

## Not rendered in-app

These live here but are deliberately absent from `CATEGORIES` — different audience:

- [Delegates](modules/delegates.md) — Delegate/referral portal (delegate audience; currently written developer-style)
- [Huginn](modules/huginn.md) — Superadmin platform assistant (module is dormant)

Internal engineering docs live in [claude/](claude/) and are not tenant-facing.
