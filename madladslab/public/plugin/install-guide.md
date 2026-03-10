# forwardChat — Consumer Website Install Guide

This guide is for website owners who have been set up with a **forwardChat** agent by madLadsLab.
You will receive a **Site Token** from your madLadsLab contact. That token is all you need.

---

## What you're installing

A lightweight AI chat widget that appears as a bubble in the bottom-right corner of your site.
The agent is configured and managed entirely from the madLadsLab dashboard — you never touch the code again after installation.

**Updates are automatic.** The snippet you install is a thin loader (~1KB). The actual chat widget lives on madLadsLab servers, so improvements, persona changes, and fixes are pushed to your site without any action on your part.

---

## Step 1 — Add the snippet to your site

Paste this tag into your HTML **before the closing `</body>` tag**, replacing `YOUR_SITE_TOKEN` with the token provided to you:

```html
<script src="https://madladslab.com/plugin/forwardchat.js?site=YOUR_SITE_TOKEN"></script>
```

That's the entire installation. One line.

---

## Step 2 — Verify it's working

1. Open your website in a browser.
2. A chat bubble should appear in the **bottom-right corner** within 1–2 seconds.
3. Click the bubble — the agent will introduce itself and ask how it can help.
4. Send a test message to confirm the agent responds.

If the bubble does not appear, see [Troubleshooting](#troubleshooting) below.

---

## Platform-specific instructions

### WordPress
1. Go to **Appearance → Theme File Editor** (or install the **Insert Headers and Footers** plugin).
2. Paste the snippet into the **Footer** section.
3. Save and visit your site.

### Shopify
1. Go to **Online Store → Themes → Edit Code**.
2. Open `theme.liquid`.
3. Paste the snippet immediately before `</body>`.
4. Save.

### Squarespace
1. Go to **Settings → Advanced → Code Injection**.
2. Paste the snippet into the **Footer** field.
3. Save.

### Wix
1. Go to **Settings → Custom Code**.
2. Click **+ Add Custom Code**.
3. Paste the snippet, set placement to **Body — end**, apply to **All Pages**.
4. Save and publish.

### Static HTML / any other platform
Paste the snippet before `</body>` in every page you want the chat to appear on,
or in your shared layout/template file so it applies site-wide.

---

## What the agent knows

The agent's personality, knowledge, and tone are all set up by your madLadsLab contact via the agents dashboard. If you want to:

- Change how the agent introduces itself
- Update what topics it handles or avoids
- Adjust its tone or persona

Contact your madLadsLab contact — no code changes are needed on your end.

---

## Lead capture

When a visitor shares their **name, email, or phone number** during a chat, the agent captures it automatically. You do not need to configure anything for this. Captured leads are:

- Saved to the madLadsLab dashboard
- Optionally forwarded to a webhook or CRM (configured by your madLadsLab contact)
- Flagged via WhatsApp alert to the madLadsLab admin

---

## Troubleshooting

**Bubble doesn't appear**
- Make sure the script tag is present in the page source (right-click → View Source, search for `forwardchat`).
- Check your browser console for a `[forwardChat]` warning message.
- Common cause: the token is missing or incorrect. Double-check it matches exactly what was provided.
- Some ad blockers or privacy extensions block external scripts. Test in an incognito window without extensions.

**Agent says "No agent assigned"**
- Your site token is valid but no agent has been assigned to it yet in the dashboard.
- Contact your madLadsLab contact to activate the agent.

**Widget appears but agent doesn't respond**
- Check your browser console for errors.
- The madLadsLab AI service may be temporarily unavailable. Try again in a few minutes.
- Contact your madLadsLab contact if the issue persists.

**Widget looks broken or overlaps my content**
- The widget uses `position: fixed` and `z-index: 9999`, which works on most sites.
- If it conflicts with your site's layout, contact your madLadsLab contact — the styling can be adjusted server-side without any changes on your end.

---

## Content Security Policy (CSP)

If your site uses a Content Security Policy header, you will need to allow the following origins:

```
script-src https://madladslab.com;
connect-src https://madladslab.com wss://madladslab.com;
```

If you are unsure whether your site uses CSP, check with your developer or hosting provider.

---

## Removing the widget

To remove the chat widget, simply delete the `<script>` tag from your HTML and save.
No data is stored on your server, so no cleanup is needed.

---

## Support

Contact your madLadsLab contact or reach us at:

- **Email:** scott@madladslab.com
- **Phone:** (682) 241-4402
- **Site:** madladslab.com
