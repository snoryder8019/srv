# Bookkeeping

Manage invoices and payments at `/admin/bookkeeping`.

## Invoices
- Auto-incrementing invoice numbers
- Line items with description, unit price, quantity
- Discounts and refunds tracked per invoice
- Status flow: Draft > Sent > Unpaid > Paid (or Void)

## Sending Invoices
Email invoices directly from the admin panel (requires Zoho email configured in Settings). Clients receive a payment link.

## Payment Links
Each invoice gets a unique `/pay/{token}` link. Clients can pay via:
- **Stripe** — Credit/debit card checkout
- **PayPal** — PayPal checkout

Payment confirmations are recorded with provider, transaction ID, amount, and timestamp.

## Recurring Invoices
Set up recurring invoices that auto-generate on schedule. Managed by the platform's cron system.
