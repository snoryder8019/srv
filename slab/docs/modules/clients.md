# Clients

Manage client records at `/admin/clients`.

A client record is the hub for one customer — their details, notes, quotes, invoices, files, and email history all hang off it.

## Client Fields
Name, email, phone, company, website, address, and status.

| Status | Use it for |
|--------|-----------|
| Prospect | A lead you haven't won yet |
| Active | A current, paying customer |
| Inactive | Dormant, may come back |
| Churned | Gone |

## Tags & Profile Completeness
Tag clients as VIP, High Value, Follow-Up, At Risk, Referral, Recurring, New Lead, or Priority. Tags are for filtering and at-a-glance triage on the list.

Each record also shows a completeness meter — email, phone, company, website, address, and whether onboarding is finished — so you can see which profiles are thin.

## Detail Tabs
| Tab | What's there |
|-----|--------------|
| Overview | Contact details, tags, status, completeness, note summary |
| Notes | The full note log for this client |
| Invoices | Bills raised against this client |
| Engagements | Quotes and letters of engagement |
| Assets | Media shared with or produced for the client |
| Files | Documents attached to the record |
| Emails | Threaded email correspondence |
| Onboarding | Intake answers and assigned onboarding forms |

---

## Notes
The Notes tab shows one merged log built from two places, and it never lists the same note twice.

- **Authored notes** — notes written in the Notes module and bound to this client. These carry the full note pipeline: auto-classification, TL;DR, tags, and distribution.
- **Pushed notes** — notes sent to this client from the Notes module's "Client Note" target. Each keeps a link back to the note it came from.

Notes you write in the Notes tab are saved into the Notes module and attached to this client, so they behave exactly like any other note.

Each row is badged **Note**, **Pushed**, or **Legacy** so you know where it came from, and the buttons match:

- **Open** takes you to the source note in the Notes module.
- **Delete** on an authored note removes it from the Notes module too.
- **Remove** on a pushed note only detaches it from this client — the original note is untouched.

## Engagements & Quotes
Engagements are your quotes and letters of engagement, built from a reusable catalogue of services and package templates.

A new engagement starts as a **draft** with a standard set of clauses you can edit — services and selection, timeline, payment, revisions and scope, materials, term and termination, and electronic signature. Add packages, write an intro, and set an expiry date.

Send it and the client gets a private link. They can pick options, leave a note, request a revision, decline, or sign electronically. Once sent, the letter is **frozen** — to change it, duplicate it, void the original, and send the new version. A signed engagement can be turned into an invoice.

An AI assistant can draft the intro paragraph and the clause text from the client and package details.

## Invoices
Raise invoices with line items or a flat amount, set a due date, and optionally make them recurring. Preview the branded invoice email before sending. Sending emails the client a pay link and moves the invoice from draft to sent.

## Files, Assets & Emails
Upload documents to the Files tab. Attachments you send on client emails are recorded there automatically, so there is always a trail of what went out.

The Emails tab groups correspondence into threads, with inline reply and an archive view for older messages. You can preview the branded email before sending, and an AI assistant can draft a message using the client's onboarding answers, invoice status, and past meetings as context.

## Onboarding Tab
Shows any onboarding form you have assigned to client records, plus the client's submitted answers. The tab also holds the basic intake fields — business type, goals, budget, timeline, social platforms, current website, brand notes, brand colours, and brand fonts.

Clients can also self-register on your public `/onboard` page, which creates or updates their client record as a prospect.

## Client Sign-In
A client can sign in with Google or Microsoft from the onboarding confirmation page. This links their login to their client record — matched by the link they were given, or failing that by their email address.

Day-to-day, clients don't need an account: quotes, invoices, and field jobs all reach them through private emailed links.

## Other Actions
- **Start a meeting** — creates a video meeting tagged to the client and emails them the join link.
- **Client research** — an AI assistant researches the client's business from their name, company, and website, and saves a report to the record.
