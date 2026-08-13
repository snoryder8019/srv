# Email Marketing

Manage contacts, capture forms, and campaigns at `/admin/email-marketing`.

## Tabs

| Tab | What it's for |
|-----|---------------|
| **Contacts** | Your mailing list |
| **Capture Forms** | Signup forms for landing pages and other websites |
| **Campaigns** | Writing and sending emails |

A dashboard sits above all three showing list growth over 30 days, audience breakdown, average open and click rates, and where your contacts came from.

## Contacts

Each contact has an email, name, funnel stage, status, source, and tags.

- **Funnel stage** — Lead, Prospect, Customer, or Churned
- **Status** — Subscribed, Pending, Unsubscribed, or Bounced

### Four ways to add contacts

1. **+ Add Contact** — one at a time
2. **Upload CSV** — needs an `email` column; `name` and `tags` are optional. Separate multiple tags in a cell with semicolons.
3. **Import Clients** — pulls every client record that has an email address. Active clients come in as Customers, everyone else as Prospects.
4. **Capture forms** — visitors who sign up through your site footer or one of your forms

Duplicate email addresses are skipped rather than updated, so importing the same file twice is safe.

**A note on CSV files:** commas inside a field will split it into the wrong columns, so avoid values like `Smith, John`.

Contacts added manually or by import are marked subscribed straight away. Make sure you have permission to email them.

## Capture Forms

A newsletter signup is already live in your site footer. Build extra forms here for landing pages or lead magnets.

Each form has a headline, sub-headline, button text, success message, funnel stage, and tags. You can collect just an email or a name as well, and write a **welcome email** that goes out automatically once someone confirms.

Every form gives you two ways to use it:

- A **hosted link** you can share anywhere
- An **embed snippet** to drop on any external website

Forms default to **double opt-in**: the subscriber gets a confirmation email and only joins your list once they click it. You can switch a form to single opt-in.

Each form card shows its signup count, how many confirmed, and a confirmation rate.

## Campaigns

**+ New Campaign** opens the composer:

- **Subject line**
- **Preheader** — the preview text shown in the inbox
- **Target funnel stage** — everyone subscribed, or just leads, prospects, or customers
- **Target tags** — optional; matches contacts carrying any of the listed tags
- **Email body**

Use `{name}` and `{email}` anywhere in the subject or body to personalise. `{name}` falls back to "there" when you don't have one.

**The body is HTML.** There are toolbar buttons for headings, bold, a CTA button, a divider, and inserting images, but plain text typed with blank lines won't keep its paragraph breaks — use the toolbar or write HTML tags.

### Before you send

- **Preview** renders the real branded email in a window.
- **Test** sends one copy to any address. It isn't tracked and doesn't count as a send.

### Sending

**Send** goes out immediately to everyone matching your targeting who is still subscribed. There is **no scheduling** — a campaign is either a draft or sent.

Sent campaigns are locked and can't be edited. Sending to a large list works through it one message at a time, so leave the page open until it finishes.

### Organising campaigns

Pin a campaign to keep it at the top, archive it to tidy it away, duplicate it, or save it as a template. Templates appear as clickable chips above the campaign list. Cards flag themselves as **Stale** when a draft has sat unsent for 30 days, or **No reach** when a send reached nobody.

## Tracking

Every sent email carries:

- **Open tracking** — an invisible image. Contacts who block images never register, so treat opens as a floor, not a precise count.
- **Click tracking** — links are rewritten to redirect through your own domain.
- **An unsubscribe link** in the footer, added automatically and never tracked.

Open a sent campaign to see totals for sent, opened, unopened, clicked, and opened-but-didn't-click, plus your top clicked links and a per-contact engagement table you can filter.

Bounces and spam complaints are only recorded if your email provider is set up to report them, which most aren't by default — so expect these to read zero.

## Follow-ups

From a sent campaign, **Create Follow-up Campaign** targets people by how they engaged: unopened, opened, clicked, opened but didn't click, or everyone from the original.

This creates a **draft** with its recipient list fixed at that moment. You still have to review and send it. Follow-ups thread underneath their original campaign in the list.

There are no automated drip sequences. The only email that sends on its own is a capture form's welcome email.

## Writing with AI

- **✦ Marketing Agent** on the Campaigns tab fills in your subject, preheader, and body from a short brief, using your brand details and a live web search. Quick prompts cover promos, newsletters, discounts, re-engagement, welcome emails, and event invites.
- **✦ Write with AI** on the Capture Forms tab fills in a form's headline, button text, success message, and welcome email.

## Requirements

Sending requires email credentials in Settings — Zoho, Gmail, Outlook, or your own SMTP server. Most providers need an **app-specific password** rather than your normal login. Campaigns fail at send time if this isn't set up, so configure and test it first. See [Settings](../platform/settings.md).

Emails are sent from your configured mailbox under your business name, and replies go back to that mailbox.

**Fill in your business location in Settings.** It appears in the email footer, and anti-spam law requires a real postal address in every marketing email.
