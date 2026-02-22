# MadLadsLab Bookkeeping System

## Overview
A self-hosted bookkeeping tool built into the MadLadsLab Express app for consolidating 3+ years of banking and credit card history into MongoDB for annual expense tracking and tax prep handoff.

Entities tracked:
- **W2 Marketing LLC**
- **madladslab LLC**
- **Scott Employment** (wages/W-2)
- **Oil Royalties** (mineral rights income)
- **VRBO** (short-term rental income)
- **Airbnb** (short-term rental income)
- **Personal / Home**

---

## Routes — `/finances`

| Method | Path | Description |
|---|---|---|
| GET | `/finances` | Transaction dashboard — filter by year, entity, source, category |
| GET | `/finances/upload` | Upload form — generic auto-detect + per-bank tabbed forms |
| POST | `/finances/upload` | Receive file, parse CSV, insert into MongoDB |
| GET | `/finances/uploads` | Recent upload history grouped by source file |
| GET | `/finances/report` | Categorical analytics — by category, month, entity, top merchants |
| POST | `/finances/transaction` | Manual transaction entry |
| PATCH | `/finances/transaction/:id` | Re-categorize / update notes on a transaction |
| DELETE | `/finances/transaction/:id` | Delete single transaction |
| DELETE | `/finances/api/batch/:source` | Delete all transactions from an uploaded file |
| POST | `/finances/api/preview` | Parse CSV and return first 5 rows without saving |
| GET | `/finances/api/summary` | JSON category totals for given year (tax export) |

---

## Files

```
routes/finances/index.js          — All routes, CSV parser, auto-categorizer, report aggregation
views/finances/index.ejs          — Transaction dashboard
views/finances/upload.ejs         — Upload page (generic + tabbed bank/CC forms)
views/finances/uploads.ejs        — Recent uploads list (grouped by file)
views/finances/report.ejs         — Categorical analytics report
views/finances/partials/
  upload-fields.ejs               — Shared form fields partial (year, type, entity, notes)
  drop-zone.ejs                   — Shared drag-and-drop file input partial
```

---

## MongoDB Collection
**`finance_transactions`** — auto-created via Mongoose (no separate model file).

### Schema fields
| Field | Type | Notes |
|---|---|---|
| date | Date | Transaction date from statement |
| description | String | Merchant / memo from statement |
| amount | Number | Negative = expense, positive = income/credit |
| category | String | Auto-assigned on upload; editable in dashboard |
| entity | String | One of the 7 tracked entities |
| taxYear | Number | 2021–2024 |
| institution | String | Bank/CC name |
| accountType | String | Checking / Savings / Credit Card / Other |
| source | String | Original filename — used to group upload batches |
| uploadedBy | String | User email or ID |
| uploadedAt | Date | Server timestamp of upload |
| notes | String | Optional free-text notes |
| raw | String | Original CSV row for audit purposes |

---

## CSV Parser — Header-Driven Auto-Detection

The parser reads the **column header row** of any CSV to locate date/description/amount columns by name — no need to know the institution format in advance.

### Header patterns recognized
- **Date**: `transaction date`, `trans date`, `date`, `datetime`, `posting date`, `posted date`
- **Description**: `description`, `memo`, `payee`, `name`, `narrative`, `details`, `note`
- **Amount**: `amount`, `transaction amount`, `net amount`, `gross`, `net`
- **Debit/Credit split**: `debit`, `withdrawal`, `credit`, `deposit` (Capital One, Citi, Wells Fargo style)

### Institution edge cases (sign flip)
- **Amex** and **Discover** export charges as positive numbers — parser flips sign when institution contains "amex" or "discover"

### Preamble skipping
Some banks (Wells Fargo, BoA) dump account info rows before the real header. The parser scans the first 10 rows to find the actual header row.

### Supported file types
`.csv`, `.pdf`, `.xlsx`, `.xls`, `.ofx`, `.qfx`
> **Note:** Only CSV files are currently fully parsed. PDF/OFX/XLSX uploads are stored as placeholder records (amount=0) pending manual entry or future parser additions.

---

## Auto-Categorization

Every transaction description is scanned against keyword rules on import. Categories are editable after the fact from the dashboard.

| Category | Example matches |
|---|---|
| Advertising & Marketing | Facebook Ads, Google Ads, Mailchimp, Canva |
| Auto & Transportation | Shell, Exxon, Uber, Lyft, AutoZone, Parking |
| Bank Fees | Monthly fee, overdraft, ATM fee, interest charge |
| Dues & Subscriptions | Netflix, Spotify, LinkedIn, membership |
| Equipment & Supplies | Amazon, Walmart, Costco, Best Buy, Staples |
| Insurance | State Farm, Allstate, Geico, Progressive |
| Legal & Professional | Attorney, CPA, TurboTax, H&R Block |
| Meals & Entertainment | DoorDash, Starbucks, Chipotle, restaurants |
| Mortgage / Rent | Mortgage, HOA fee, rent payment |
| Oil & Gas Royalties | Royalty, mineral rights, Devon Energy |
| Payroll / Wages | ADP, Gusto, direct deposit, payroll |
| Repairs & Maintenance | Home Depot, Lowe's, HVAC, handyman, lawn |
| Short-Term Rental | VRBO, Airbnb, Vacasa (host payments) |
| Software & Tech | AWS, GitHub, Adobe, Stripe, Cloudflare, domain |
| Travel | Delta, Marriott, Expedia, rental car |
| Utilities | Xcel Energy, Comcast, AT&T, Verizon |
| Contractors / Labor | Upwork, Fiverr, 1099, subcontract |

---

## Report Page (`/finances/report`)

Filters by year and entity. Shows:
1. **Summary cards** — Total Income / Total Expenses / Net / Transaction count
2. **Category bar chart** — Horizontal bars scaled to largest category
3. **Category table** — Expense, income, count per category; links filter the dashboard
4. **Month-by-month grid** — Each month: expense, income, net
5. **Entity breakdown** — Income/expense/count per entity
6. **Top 15 merchants by spend** — Derived from first 4 words of description

---

## Upload Flow

1. Go to `/finances/upload`
2. Use **"Any Bank — Auto-Detect"** section at the top for any CSV
3. Optionally click **Preview** to see first 5 parsed rows before committing
4. Fill in entity and tax year, click **Import All**
5. Success message shows row count + **"View →"** link to filtered dashboard
6. View all batches at `/finances/uploads` — delete a batch or drill into its transactions
7. Run `/finances/report` to see categorical breakdown

---

## Tax Prep Export

`GET /finances/api/summary?year=2023` returns JSON:
```json
{
  "success": true,
  "data": [
    { "_id": { "entity": "W2 Marketing LLC", "category": "Advertising & Marketing" }, "total": -4823.50, "count": 47 },
    ...
  ]
}
```

---

## Navigation
- Admin footer nav → `$ Bookkeeping` → `/finances`
- Dashboard header → `Report`, `Recent Uploads`, `+ Upload Statements`
- Upload page header → `Recent Uploads`, `← Dashboard`
