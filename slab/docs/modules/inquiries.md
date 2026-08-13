# Inquiries

Review contact-form submissions at `/admin/inquiries`.

Every message sent through the contact form on your public site lands here. Custom fields you added to your contact form are captured alongside the standard name, email, company, service, and message.

## Status Filters
The list opens on active inquiries — archived and spam are hidden until you pick those filters. Each filter shows a live count.

| Status | Meaning |
|--------|---------|
| New | Just arrived, not opened yet |
| Read | You have opened it (set automatically on first view) |
| Replied | You sent a reply from the detail page |
| Converted | Turned into a client record |
| Archived | Done with, kept for reference |
| Spam | Junk — sender is blocked from your contact form |

Search by name, email, company, or message text. The list shows the 200 most recent matches.

## Working an Inquiry
Open an inquiry to see the full message, any custom fields, and whether that email address is already a client or a marketing contact.

- **Reply** — write a subject and body and send it straight from the page. The reply goes out from your business email address, the inquiry flips to Replied, and the reply is kept on the record.
- **Convert to client** — creates a client record and marks the inquiry Converted.
- **Add to marketing** — pushes the sender into your email marketing contacts, tagged `contact-form`, in the funnel stage you pick.
- **Delete** — removes the inquiry permanently.

## Converting to a Client
Converting checks the email address first. If a client with that email already exists, the inquiry is linked to them instead of creating a duplicate. A new client is created as a **prospect**, with the service they asked about, their message, and any custom fields copied into the client's notes.

## Bulk Actions
Select multiple rows on the list to change status in one go, mark them as spam and block the senders, or delete them. Spam and delete both ask for confirmation.

---

## Spam Handling
Three layers keep junk out, and none of them silently lose a real lead.

### Bot Honeypot
Your contact form contains a hidden field that real visitors never see. Automated bots fill it in. Those submissions are saved as **Spam** rather than discarded, so a person whose password manager tripped the trap is still recoverable. The Spam tab shows how many were caught this way.

### Blocked Senders
Marking an inquiry as spam also adds the sender's address to your blocked list. After that, anything they submit is dropped without a trace — they get the same "thanks" page and no hint that they were blocked.

Manage the list from the **Blocked Senders** panel on the Spam tab: add an address by hand, or remove one to unblock a sender you flagged by mistake.

### Global Spam Filter
Slab also runs a shared filter across all businesses on the platform. When enough separate businesses flag the same sender or the same spam phrase, it is promoted to the global list.

A global match is **not** dropped — it is saved into your Spam tab so you can see it and decide. Only your own blocked-senders list drops messages outright.

The panel for editing the global list is visible to platform staff only.
