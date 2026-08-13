# Users, Roles & Permissions

Manage who can get into your workspace, and what they can do once they're in, at `/admin/users`. Reusable permission bundles live at `/admin/roles`.

Both pages are reserved for the workspace owner and unrestricted admins.

## How Someone Joins

There is no invite form. A person appears on your Users list the first time they sign in to your site. Until you give them a role, they have no admin access — signing in alone grants nothing.

So the flow is: **they sign in once → you find them on the Users list → you set their role and access.**

## Account Types

| Type | What it means |
|------|--------------|
| **Admin** | Full access to your workspace |
| **Collaborator** | Gets into the admin panel, but only sees the tools you grant |
| **Client** | Portal access only — their invoices and shared files. No admin panel. |
| **None** | Signed in, no access yet |

## The Access Rule

This is the one thing worth understanding, because it is not what people usually expect:

**An empty permission list means full access.**

| Person | Sees |
|--------|------|
| Owner | Everything |
| Admin with no permissions ticked | Everything ("unrestricted") |
| Admin or collaborator with permissions ticked | Only those tools |

Nobody is accidentally locked out by this design — someone only becomes restricted when you deliberately tick boxes for them. Ticking one box is what turns a full-access account into a limited one.

Two tools sit outside the permission system entirely. **Users & Permissions**, **Roles**, **Settings & Keys** and **Labs** can only be opened by the owner and unrestricted admins. They can't be granted to a restricted collaborator — so someone brought in to write blog posts can never reach your API keys, your billing, or the page that controls everyone else's access.

## Setting Someone's Access

1. Find them on the Users list — filter by type, by role, or by full vs. restricted access
2. Set their account type (admin, collaborator, or client)
3. Either **apply a role** (recommended) or tick individual permissions by hand
4. Save

Ticking permissions by hand detaches the person from any role they were on; their access becomes "Custom" and stops following that role.

## Roles

A role is a **named bundle of permissions** — "Content Editor", "Finance Manager" — that you build once and hand to as many people as you like. Manage them at `/admin/roles`.

### Why use roles

- Set up access once instead of ticking the same twenty boxes for every new hire
- **Editing a role updates everyone on it.** Add Analytics to "Marketing" and every marketer gets it immediately — no need to revisit each person.
- Roles carry a name and a color, so the Users list shows at a glance who does what

### Building a role

1. Go to `/admin/roles` and create a role
2. Give it a name, a color, and a short description
3. Tick the tools it should include — they're grouped exactly like the sidebar
4. Save, then apply it to people from the Users page

### Starter roles

If you'd rather not start from a blank page, the Roles page can seed a set of ready-made roles:

| Role | Covers |
|------|--------|
| **Content Editor** | Pages, Blog, Portfolio, Marketplace, Design, Assets |
| **Finance Manager** | Bookkeeping, Ledger & P&L, Calculators, Analytics |
| **CRM / Sales** | Inquiries, Clients, Onboarding, Help Requests |
| **Marketing** | Email Marketing, Social, QR Codes & Card, Print Studio |
| **Scheduling** | Meetings, Booking, Notes |

Seeded roles are ordinary roles — rename them, re-scope them, or delete them.

### Applying and detaching

- **Applying a role** copies its permissions onto the person and gives them panel access if they didn't have it
- **Detaching from a role** leaves their current permissions in place; they simply stop tracking future changes to that role
- **Deleting a role** doesn't strip anyone's access — people keep the permissions they had

## Linking a User to a Client Record

If someone signing in is a customer rather than staff, link their account to their client record. That connects their portal to the right invoices and files. Unlinking is equally reversible, and deleting a user releases the link automatically.

## Notes

- You cannot delete your own account from this page
- Changing someone's access takes effect on their next page load — no need to make them sign out
- If a restricted person opens the address of a tool they don't have, they're returned to the dashboard with a short message rather than an error page
- Which tools exist to grant at all depends on what your workspace has enabled — see [Admin Panel](../platform/admin-panel.md)
