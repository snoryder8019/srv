# Admin Routes

All routes under `/admin/*` are defined in `routes/admin.js` and protected by `requireAdmin` middleware (except `/admin/login`).

## Overview

- **Purpose**: Manage various aspects of the application through a protected admin interface.
- **Key Files**: `blog.js`, `copy.js`, `sections.js`, `pages.js`, `masterAgent.js`, etc.

## Route Details

| File          | Route                | Collections | AI Agent | Notes |
|---------------|----------------------|-------------|----------|-------|
| `blog.js`     | `/admin/blog`        | `blog`      | Yes      |       |
| `copy.js`     | `/admin/copy`        | `copy`      | Yes      |       |
| `sections.js` | `/admin/sections`    | `custom_sections` | Yes      |       |
| `pages.js`    | `/admin/pages`       | `pages`     | Yes      |       |
| `masterAgent.js` | `/admin/master-agent` | cross-module | Yes      | Two-step process |
| `portfolio.js` | `/admin/portfolio`   | `portfolio` | No       |       |
| `clients.js`  | `/admin/clients`     | `clients`, `client_emails` | No       |       |
| `bookkeeping.js` | `/admin/bookkeeping` | `invoices`, `invoice_counter` | No       |       |
| `emailMarketing.js` | `/admin/email-marketing` | `contacts`, `campaigns`, `campaign_events` | No       |       |
| `meetings.js` | `/admin/meetings`    | `meetings`  | No       |       |
| `assets.js`   | `/admin/assets`      | `assets`, `asset_folders` | No       |       |
| `design.js`   | `/admin/design`      | `design`, `themes`, `brand_images` | No       | `DESIGN_DEFAULTS` required |
| `settings.js` | `/admin/settings`    | `slab.tenants` (registry) | No       | Encrypts secrets |
| `users.js`    | `/admin/users`       | `users`     | No       |       |
| `profile.js`  | `/admin/profile`     | `users`     | No       |       |
| `tts.js`      | `/admin/tts`         | —           | No       |       |
| `tutorials.js` | `/admin/tutorials`   | —           | No       |       |

## Integration Status

- `res.locals.integrations` includes `zoho`, `stripe`, `paypal`, `google`, `oauth`, `ai`, `s3`.

## Key Patterns

- **Agent Routes**: Search-first, return `{ message, fill: { field: value } }`.
- **Master Agent**: Two-step process (research → generate) with `/execute` for direct DB writes.
- `DESIGN_DEFAULTS` in `design.js` — any new design key must be added here.
- Settings reads/writes `slab.tenants` via `getSlabDb()`.
- Settings encrypts secret fields via `plugins/crypto.js` before save.