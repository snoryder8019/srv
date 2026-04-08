# Delegates — Sales Sheets & Lead Management

Delegates are independent sales agents who promote Slab tenants and earn commissions on referrals. The delegate system includes a referral code promo, a CRM-style lead tracker, and sales sheets per assigned brand.

---

## Delegate Portal Routes

All routes are mounted under `/delegates/` and protected by `requireDelegate` middleware (JWT cookie set at `/delegates/login`).

### Sales Sheets

| Route | Method | Description |
|-------|--------|-------------|
| `/delegates/panel/sales-sheets` | GET | Lists all brands the delegate is assigned to, with lead/conversion counts |
| `/delegates/panel/sales-sheets/:tenantId` | GET | Full sales sheet for one brand — brand info, lead stats, all leads with history |
| `/delegates/panel/leads/add` | POST | Add a new lead for a brand |
| `/delegates/panel/leads/:leadId/update` | POST | Update lead status or tags |
| `/delegates/panel/leads/:leadId/log-call` | POST | Append a call log entry (outcome + notes) |
| `/delegates/panel/leads/:leadId/delete` | POST | Delete a lead (delegate-scoped) |

Navigation links to Sales Sheets appear in both the delegate panel topbar (`panel.ejs`) and the settings page (`settings.ejs`).

### Lead Data Model (`delegate_leads` collection — slab registry DB)

| Field | Type | Description |
|-------|------|-------------|
| `delegateId` | ObjectId | Owning delegate |
| `delegateEmail` | string | Delegate email (denormalized) |
| `tenantId` | ObjectId | Brand the lead is for |
| `tenantDomain` | string | Brand domain (denormalized) |
| `name` | string | Lead name (required) |
| `email` | string | Lead email (lowercased) |
| `phone` | string | Lead phone |
| `company` | string | Lead company |
| `notes` | string | Free-form notes |
| `tags` | string[] | Subset of: hot, warm, cold, follow-up, demo-scheduled, pricing-sent, no-answer |
| `status` | string | One of: new, contacted, callback, interested, converted, lost |
| `callLog` | array | `{ date, outcome, notes }` entries appended by log-call route |
| `createdAt` | Date | |
| `updatedAt` | Date | Updated on every status/tag/call change |

### Valid Lead Statuses
`new`, `contacted`, `callback`, `interested`, `converted`, `lost`

### Valid Lead Tags
`hot`, `warm`, `cold`, `follow-up`, `demo-scheduled`, `pricing-sent`, `no-answer`

---

## Delegate Referral Promo (Onboarding Integration)

Delegates have a unique referral code in the format `SD-XXXXXXXX` (stored as `refCode` on the `sales_delegates` doc). When a new signup arrives at `/start?ref=SD-XXXXXXXX`, the onboarding flow:

1. Shows a "30 Days Free" banner on the signup page
2. Passes `ref` through to both the email/password and Google One Tap signup flows
3. Validates the code against `sales_delegates` (must be `status: 'active'`)
4. Applies a 30-day free trial perk to the new tenant
5. Records a `delegate_referrals` document for commission calculation

### Referral Promo — Tenant Fields Set

These fields are set on `slab.tenants` when a delegate referral is applied:

```
perks.delegatePromo: true
perks.delegatePromoAt: Date
perks.trialEndsAt: Date (now + 30 days)
perks.referredBy: { delegateId, delegateEmail, refCode }
```

### Referral Tracking (`delegate_referrals` collection — slab registry DB)

| Field | Type | Description |
|-------|------|-------------|
| `delegateId` | ObjectId | |
| `delegateEmail` | string | |
| `refCode` | string | e.g. `SD-A1B2C3D4` |
| `signupEmail` | string | New tenant owner email |
| `subdomain` | string | New tenant subdomain |
| `promoDays` | number | Always 30 |
| `trialEndsAt` | Date | |
| `convertedToPaid` | boolean | Initially false; updated by billing flow |
| `createdAt` | Date | |

### Signup Record Change

The `slab.signups` collection now includes `refCode: string | null` on every signup document (null if no referral).

---

## Commission Calculation

Monthly commissions are calculated via `POST /delegates/admin/calculate-commissions` (admin-only). Commissions are based on `delegate_referrals` records where `convertedToPaid: true`.

---

## Views

| File | Description |
|------|-------------|
| `views/delegates/sales-sheets.ejs` | Brand overview grid with lead/conversion counts |
| `views/delegates/sales-sheet-detail.ejs` | Single-brand CRM: stats bar, lead table, add-lead form, call log modal |
| `views/delegates/panel.ejs` | Main dashboard — now includes Sales Sheets nav link |
| `views/delegates/settings.ejs` | Settings page — now includes Sales Sheets nav link |
