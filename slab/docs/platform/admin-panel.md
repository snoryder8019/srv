# Admin Panel

Your admin workspace lives at `/admin`. Sign in with an account that has admin access.

## Dashboard

The dashboard is the landing screen: quick stats across your content, clients and invoices, plus the main AI assistant. Ask it to write a post, update copy, or build a page and it routes the job to the right specialist.

## Sidebar Navigation

The sidebar is grouped into sections. What you see depends on which features your workspace has and what you personally are allowed to open.

| Section | Tools |
|---------|-------|
| **Overview** | Dashboard |
| **Content** | Pages, Blog, Portfolio, Marketplace, Design & Copy, Assets, Careers |
| **Clients & CRM** | Inquiries, Clients, Onboarding, Help Requests, In the Field |
| **Meetings** | Meetings, Booking, Notes |
| **Marketing** | Email Marketing, Social Media, Live Studio, QR Codes & Card, Print Studio |
| **Finance** | Bookkeeping, Ledger & P&L, Calculators, Analytics |
| **Admin** | Users & Permissions, Roles, Settings & Keys, Docs & Guides, Labs |

## How Features Become Visible

Every tool in Slab sits at one of four release stages. The stage is set by the platform, not by you.

| Stage | What it means for you |
|-------|----------------------|
| **Visible** | Generally available. In your sidebar, no badge. |
| **Beta** | Available to everyone, still being polished. Badged `beta`. |
| **Experimental** | Hidden until **you** switch it on at `/admin/labs`. Badged `exp` once enabled. |
| **Off** | Not available to any workspace right now. |

### Labs — turning experimental features on

`/admin/labs` lists the experimental tools your workspace could try. Flip one on and it appears in the sidebar immediately, for everyone in your workspace who has permission for it. Flip it off and it disappears again — your data is not deleted.

The Labs link only shows up when there is actually something to opt into, and only the workspace owner or an unrestricted admin can change it.

### Slab Functions — tidying the sidebar

Slab's toolkit runs deep, and most businesses only use part of it. Under **Settings → Slab Functions** you can switch off the advanced and experimental tools you don't use, so the sidebar stays focused.

- This is a **menu-tidying setting**, not a security setting
- It applies to the whole workspace, not to one person
- A switched-off tool is hidden from the sidebar and blocked if someone types its address directly
- Turn it back on any time — nothing is lost

## Who Can See What

Access inside your workspace works on a simple rule: **an empty permission list means full access.**

| Person | What they can open |
|--------|-------------------|
| **Owner** | Everything the workspace has |
| **Admin with no permission list** | Everything the workspace has ("unrestricted") |
| **Admin with a permission list** | Only the tools on their list |

Two extra rules matter:

- **Sensitive tools are owner-only.** Users & Permissions, Roles, Settings & Keys, and Labs can be opened by the owner and by unrestricted admins only. They can never be granted to a restricted collaborator — so a blog-only helper can't reach your API keys or change who has access.
- **Restricting someone is deliberate.** Because an empty list means full access, no existing admin is ever silently locked out when permissions are introduced. Someone becomes restricted only when you actually tick boxes for them.

If a restricted person types the address of a tool they don't have, they're sent back to the dashboard with a short explanation.

See [Users & Permissions](../modules/users.md) for how to assign permissions and roles.

## AI Assistant

Content editors — Blog, Design & Copy, Pages, Sections — have a slide-in AI panel. Open it and describe what you want; it can research a topic, draft content, and fill form fields for you. Filled fields are highlighted so you can review, and each one can be reverted.

See [AI Agents](ai-agents.md) for the full picture.

## The Corner Dock

The bottom-right corner holds a single collapsible dock instead of a stack of floating buttons. Tap the round toggle and the tools fan out above it:

| Tool | What it does |
|------|-------------|
| **Assistant** | Opens the AI agent chat from anywhere in the admin |
| **Notifications** | Your alert bell — a red dot on the collapsed dock means unread |
| **Report a bug** | Sends us what went wrong, with page context attached |
| **Help** | Replays the guided tour for the page you're on |

The dock only shows the tools available on the current page.

## Your Profile

Click your name in the sidebar footer for profile settings and account options. You can also reset the guided tours there — either all of them, or just the one for a single page — if you want to see the walkthroughs again.
