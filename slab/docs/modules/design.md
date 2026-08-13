# Design & Theming

Customize your site's look and homepage content at `/admin/design`.

The screen is split in two: an editing panel on the left, and a live preview of your site on the right. Changes appear in the preview as you make them. Press **Save All** at the top to commit everything on the panel.

## The Three Tabs

| Tab | What lives there |
|-----|------------------|
| Design | Colors, fonts, styling, logos, themes, tracking |
| Content | The words on your homepage, section visibility, header and footer |
| Layout | What renders on your homepage, and which look it uses |

## Editing On the Canvas

Instead of hunting for the right field, you can edit your homepage directly in the preview. Click **Edit on canvas** in the preview toolbar.

With canvas editing on:

- Hovering over text or an image outlines it and names the field
- Clicking text lets you type straight into the page
- Clicking an image opens your asset library to swap it
- The matching field opens and highlights in the left panel, so you always know where a piece of content lives
- A **+** button on a group of service cards, process steps, or stats duplicates the last one
- Hovering in the gap between two sections reveals a **+** strip — click it to insert a new section at that exact spot

Edits save automatically a moment after you stop typing, in batches; the status text beside the toolbar confirms each save. Click **Edit on canvas** again to turn it off. It works on both your standard homepage and on an activated block template.

---

## The Design Agent

Rather than setting fields yourself, you can describe what you want and let the design agent do it. Open it with the **Agent** button in the preview toolbar.

The agent works across all three tabs — it can change colors, fonts, your homepage wording, and which sections show, all in one go.

### Asking About One Part of the Panel

Small **AI** buttons appear in the left panel when you hover. There are two kinds:

- **On a section** — one button at the top of each section, like Colors or Header & Footer. It focuses the agent on that whole section, and it changes those fields together so the result stays consistent. This is how you reach the smaller controls: colors, sliders, dropdowns and toggles do not have buttons of their own.
- **On a long text box** — every multi-line field has its own button, because writing real copy deserves a dedicated ask. The agent writes the actual words, not a description of them.

Focused questions never ask you about the throttle — the focus already sets the limits. The agent tells you if something outside your focus has to move too, for example a color that would no longer have enough contrast.

### How Hard to Hit the Throttle

When you ask for something sweeping — "redesign the site", "give it a modern refresh" — the agent stops and asks how hard to hit the throttle before touching anything:

| Level | What it does |
|-------|--------------|
| Light | One thing only, around six fields. Nudges rather than replaces. |
| Balanced | A few related things, around eighteen fields. Same structure, new skin. |
| Full send | Design, Content and Layout together, up to forty-five fields. Bold and opinionated. |

The level controls both how much of your site the agent looks at and how far it is allowed to go. If it wants to change more than the level allows, the extra changes are held back and it tells you — ask again with a harder throttle to go further.

Narrow requests and field-focused questions skip the throttle question entirely.

### Undo

Every change the agent makes is a preview only — nothing is written to your site until you press **Save All**. When the agent updates fields, a message appears with an **Undo** button and a countdown. Pressing Undo puts every field back exactly as it was.

### Telling Us How It Did

Each agent reply has a 👍 and 👎. Pressing either sends the request and what it changed back to the developers so the agent can be improved. Nothing on your site changes when you do this.

---

## Layout Tab

### Homepage Source

This decides what visitors see at your site's root address.

- **Slab** (the default) — your homepage is rendered by the platform, using the look you pick below
- **Custom** — a bespoke homepage built for you by a developer

The panel always shows what is *currently* rendering, so you can tell at a glance whether a look, a template, or a custom layout is live. If you pick Custom but no bespoke layout exists for your site, Slab rendering is used instead — you never get a blank page. A custom layout still inherits the colors and fonts you set here.

### Homepage Look

Seventeen looks are available, from Classic and Minimal through to Lowlight, Terminal, Arena, and Gallery.

**Switching a look does not touch your content.** Your homepage renders all the same words, sections, and modules — only the styling changes.

After you pick a look, a countdown appears with **Keep this look** and **Undo**. If you do not press *Keep* within 20 seconds, your previous look is restored automatically — so trying a look on your live site is always safe.

### Standard Layout

Fine-tunes the built-in homepage: the base layout, how sections animate in on scroll, and optional scroll snapping between sections.

---

## Content Tab

- **Section Visibility** — show or hide each part of your homepage: Hero, Ticker / Marquee, Services, Portfolio, About, Process, Pricing, Reviews, Contact, Blog, Careers, Marketplace, QR Code, and the admin login link
- **Homepage copy** — separate sections for Hero Copy, Hero Slides, Services, About, Process, Pricing Tiers, and Contact. Service cards, process steps, and stats can be added and removed rather than being fixed at three or four
- **Header & Footer** — structure, spacing, which elements appear, colors, and your own custom navigation links
- **Cookie Consent** — the wording of the consent notice

### Custom Sections

**+ Add Custom Section** adds a section beyond the built-in ones. Twelve types are available: Text, Split, CTA Banner, Cards, Writer Feed, FAQ, Stats, Testimonials, Gallery, Video, Pull Quote, and Banner. See [Sections](sections.md).

---

## Design Tab

### Colors

Three colors set your brand. Everything else is derived automatically and only needs attention in unusual cases.

| Token | Purpose |
|-------|---------|
| Primary | Brand color — nav, headings, buttons |
| Accent | CTAs, highlights, badges |
| Background | Section and page backgrounds |

Under **Advanced** you can also set Primary Deep, Primary Mid, Accent Light, two extra accents for multi-brand setups, and the text, surface, muted, border, success, and danger colors.

### Typography

A heading font and a body font, chosen from the full Google Fonts catalog. Weights are handled for you.

### Logos & Brand Images

| Slot | Used for |
|------|----------|
| Primary Logo | Header and default logo |
| White Logo | Dark backgrounds, such as the footer |
| Icon / Favicon | Browser tab and small contexts |
| Social Logo / Social Logo (white) / Social Badge | Auto-generated social posts |
| Banner | Hero and share image |
| Share Image (1.91:1) / Share Square (1:1) | Link previews when your site is shared |

### Themes

Save your current colors, fonts, and styling as a named theme, then switch between saved themes later. Applying a theme changes styling only — it never touches your words.

### Other Design Sections

- **Hero & Section Styling** — hero style, height, overlay, background media, card styling
- **Display Layouts** — how portfolio and blog lists are arranged, and how your logo shows in the nav
- **AI Assistant** — the name and greeting your site's chat assistant uses
- **Cookie Consent** — turn the consent notice on and style it (its wording lives on the Content tab)
- **Custom Elements** — toggle floating on-site elements such as the bug button and notification bell
- **Head, Favicon & Tracking** — favicon, Google Tag Manager, site verification tokens, custom HTML
- **3D Models** — optional 3D model in the header or logo

---

## Templates and the Template Store

Beyond looks, Slab supports **block templates** — homepages assembled from a stack of blocks rather than from your standard sections. This is an advanced path; most sites are better served by a look.

Build one from the **Advanced: block template** link on the Layout tab, or browse community templates at `/admin/template-store`, vote on them, and download one into your own library to edit.

Templates carry a **skin** — Classic, Lowlight, Terminal, Arena, or Gallery — that sets their visual world, plus a snapshot of the colors and fonts they were designed with, so store previews look the way their author intended.

## Your Content Is Never Lost

Switching between looks, templates, and the standard layout only changes *what renders*. Your words and design settings are kept either way.

Slab also takes an automatic backup of your homepage state — source, active template, all copy, all design settings — immediately before every switch, and keeps the last ten, so a switch that looks like it lost content is recoverable. And if you activate a block template, switch to another, and come back, the content edits you made to the first come back with it.
