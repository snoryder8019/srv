# Ledger & P&L

Track income, expenses, and profit at `/admin/ledger`.

The Ledger is your books. Every line points at one account, and that account decides where the money lands on your Profit & Loss.

## The Tabs
| Tab | What it's for |
|-----|---------------|
| P&L | Profit & loss for a month or quarter, against budget and the prior period |
| Ledger | The month's transactions — add, tag, attach receipts |
| Adjustments | Fine-tune posted lines and see who changed what |
| Scan | Photograph a receipt, let AI read it, approve it |
| Statements | Upload a bank statement PDF and pick the business lines |
| Budget | Your yearly plan — projected revenue and spend targets |
| GL Accounts | Your chart of accounts |
| Mileage | Business trips, valued per mile |
| Utilities | Recurring bills like power, internet, and water |

## GL Accounts
Your chart of accounts. The first time you open the Ledger, a starter set is created for you — edit it to match your business.

| Type | Code range | Where it lands |
|------|-----------|----------------|
| Income | 4000s | Revenue |
| Cost of Goods Sold | 5000s | Subtracted from revenue to get gross profit |
| Labor | 5500s | Subtracted from gross profit |
| Fixed Costs | 5800s | Subtracted from gross profit |
| Operating Expense | 6000s | Subtracted from gross profit |
| Liability | 2000s | Balance sheet only — never on the P&L |

- New accounts get the next code in their band automatically.
- **Renumber** re-sequences every account in steps of 10.
- Deleting an account that's already in use archives it instead, so your history stays intact.
- Use Liability for things like a loan or mortgage principal payment, so paying down debt doesn't read as an expense.

## Ledger
The month's transactions. Use the arrows to move between months.

- Add a line with a date, account, amount, description, vendor, tags, and an optional receipt.
- Filter the month by tag.
- Running totals show income, expense, and net. Liability lines are left out of that tally.
- **Sync paid invoices** pulls this month's paid invoices in as income, once each. Set the account it uses on the Mileage tab's settings.
- Receipts are stored privately and only ever shown to signed-in admins. Lines that came from a bank statement are grouped, so you can open one batch and see everything charged from the same PDF.

## Adjustments
A per-month review of everything posted, plus a running change log of who edited what.

- **Move account** — reassign a posted line to a different account without deleting it.
- **Allocation %** — post only part of a line as business. A $2,000 payment at 50% posts $1,000; the rest stays private.
- **Transfer** — move a cost onto another business you own. It leaves your books and lands on theirs. Owners only.

Every one of these is written to the change log with your name, the old value, and the new one.

## Scan
Photograph or upload a receipt or invoice and AI reads the vendor, date, total, and tax off it.

- Nothing posts on its own. The scan sits in **Awaiting review** until you approve it.
- Check the fields, pick an account, then approve — that's the moment a ledger line is created.
- Works on photos and images. PDFs and unreadable files are stored for you and the fields are left blank to fill in by hand.
- Reject or delete anything you don't want.
- When you approve, we remember which account you used for that vendor and pre-fill it next time.

## Statements
Upload a bank or credit-card statement PDF and we list every transaction on it so you can pick out the business ones.

**Nothing on a statement posts to your books by itself.** Every extracted line starts as **Private**. A private line is never charged to the ledger, never appears on your P&L, and never counts toward a total. Only the lines you personally mark as business — and give an account to — are posted, and only when you click Post.

### How it works
1. Upload the statement PDF (text PDFs, up to 25 MB — a scanned photo of a statement has no readable text).
2. We read every transaction line: date, description, amount, and whether money went out or came in.
3. Lines from merchants you've categorized before are pre-filled and highlighted, but they're still yours to confirm.
4. Review each line and set what it is.
5. Post the business lines. Everything else stays private.

### Setting what each line is
| Setting | What happens |
|---------|--------------|
| Private | Default. Nothing posts. The line stays on the statement record only |
| Business (full) | The whole amount posts to the account you pick |
| Allocate % | Only the percentage you enter posts; the remainder stays private |

### Reviewing
- Edit any line's date, description, amount, or direction — auto-reading isn't perfect, so check the amounts.
- Delete a line you don't want listed, or add a transaction the reader missed.
- **Save review** stores your work without posting anything.
- **Post** saves the review and posts the business lines in one step.
- Posted lines lock. The statement stays open so you can come back and post more later.
- **Done reviewing** files it under Recently handled. Reopen it anytime.

### Undoing
- **Uncharge** a posted line from the Ledger tab — it comes off your books and its statement line goes back to private for another look.
- **Trash** a whole statement and any lines it posted come off the ledger with it.
- **Restore** puts a trashed statement and its lines back exactly as they were.
- **Restore & retry** brings it back for review with the ledger cleared, so you can fix amounts and post again.
- **Delete forever** also removes the stored PDF and can't be undone.

### Your bank
We detect the issuer from the statement header and show whether we've validated that bank's layout. If we got it wrong, set the bank yourself. If your bank isn't recognized yet, you can file a request to have it added — you can still review and post the statement by hand in the meantime.

## Mileage
Log a trip with the date, purpose, from and to, miles, and vehicle. Miles times your rate becomes a deductible expense against the account you choose. The default per-mile rate is set once and applies to new trips.

## Utilities
Log recurring bills with the provider, service period, and amount. If you split a building bill with someone else, enter your share percentage and only your portion is recorded as the expense.

## Budget
A yearly plan, kept completely separate from your actuals.

- Set projected annual revenue, and optionally split it across four quarters.
- Budget most accounts as a percentage of revenue.
- Budget Labor and Fixed Costs as a flat annual dollar amount, since they don't move with sales.

## P&L
Revenue less cost of goods sold gives gross profit; less labor, fixed, and operating expense gives net profit.

- View by month or by quarter.
- Compare against the period before, or the same period last year.
- Every number shows actual, budget, percent of budget, and the change against your comparison period.
- Click into any number to see the individual transactions behind it, receipts included.

## Exports
Both the P&L and the Budget export as **Excel**, **CSV**, or a **print-ready page** — ready to hand to an accountant.
