# Bookkeeping

Manage invoices and payments at `/admin/bookkeeping`.

Bookkeeping is where you bill clients and get paid. It shows every invoice you've raised, what's been collected, and what's still outstanding.

## The Dashboard
Four figures across the top:

- **Revenue** — total collected on paid invoices, and how many were paid
- **Outstanding** — total still owed across unpaid, sent, and overdue invoices
- **Refunded** — total refunded back to clients
- **Gateways** — whether Stripe and PayPal are connected

Filter the list by status, payment provider, or client.

## Creating Invoices
Invoices are raised from a client's record — open the client at `/admin/clients` and use the Invoices tab.

- Add line items with a description, quantity, and unit price. The total adds itself up.
- Invoice numbers are assigned automatically as `PREFIX-YEAR-0001`, where the prefix comes from your brand name (or one you set in Settings).
- Give it a title, due date, and any notes for the client.

## Invoice Status
| Status | Meaning |
|--------|---------|
| Draft | Created but not sent to the client |
| Sent | Emailed to the client |
| Unpaid | Awaiting payment |
| Overdue | Past its due date and still unpaid |
| Paid | Payment received in full |
| Void | Refunded or cancelled |

Invoices past their due date are marked overdue automatically each morning.

## Sending Invoices
Email an invoice straight from the admin panel. This requires your outgoing email to be configured in Settings.

- Preview the exact branded email — logo, colors, line items, and pay button — before you send it.
- Sending a draft moves it to Sent.
- The email includes the client's payment link.

## Getting Paid
Every invoice gets its own private payment link at `/pay/{token}`. Copy it from the invoice row and share it however you like, or let the invoice email carry it.

Clients can pay by:

- **Stripe** — credit and debit card checkout
- **PayPal** — PayPal checkout

Add your Stripe and PayPal keys under Settings before taking payments. PayPal can run in sandbox mode while you test.

When a payment lands, the invoice flips to paid and the client is emailed a receipt automatically — exactly once, no matter how the confirmation arrives. Each payment is recorded with its provider, transaction ID, amount, and timestamp.

## Discounts
Apply a discount to any invoice with an amount and a reason. The invoice total is reduced and the discount is kept on the record with your name and the date.

## Refunds
Refund a payment directly from the invoice row. Leave the amount blank for a full refund, or enter a smaller figure for a partial one. The refund is sent through the original provider, recorded on the invoice, and the invoice is marked void.

Paid invoices can't be deleted — refund or void them first, so the audit trail survives.

## Recurring Invoices
Turn any invoice into a recurring template when you create it.

| Frequency | Next invoice |
|-----------|-------------|
| Weekly | Every 7 days |
| Biweekly | Every 14 days |
| Monthly | Same date next month |
| Quarterly | Every 3 months |
| Yearly | Same date next year |

- Generated invoices are due in 14 days for weekly and biweekly, 30 days otherwise.
- Turn on **auto-send** and each new invoice is emailed to the client the moment it's generated.
- The sweep runs once a day, early morning. It never double-bills and never silently skips a day.

## Getting Invoices Into Your Books
Bookkeeping tracks what you've billed. To fold that revenue into your Profit & Loss, open the Ledger tab and use **Sync paid invoices** — it pulls the month's paid invoices in as income, once each. See the Ledger & P&L doc.
