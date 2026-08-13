# AI Agents

Slab ships with a team of AI assistants. Rather than one chatbot that does everything badly, each job has a specialist — a blog writer, a design agent, an invoice drafter — and a coordinator that decides which one to hand your request to.

## How to Use Them

The quickest route is to just ask.

1. Open the assistant — from the dashboard, from the corner dock on any admin page, or from the AI panel inside a content editor
2. Describe what you want in plain language: *"Write a blog post about spring maintenance"*, *"Make the site colors warmer"*, *"Draft an invoice for the Miller job"*
3. The coordinator picks the right specialist and runs it
4. Review the result — filled fields are highlighted, and each can be reverted before you save

You never pick an agent by name. Describing the outcome is enough.

## The Agent Roster

| Area | Agents |
|------|--------|
| **Coordinator** | Decides which specialists to call for each request |
| **Support** | Support Concierge — the public, visitor-facing agent |
| **Content** | Blog, Site Copy, Section, Page |
| **Design** | Design, Theme, Typography, Section Visibility |
| **Marketing** | Social Post, Social Batch, Carousel, Story Sequence, Social Insights, Social Scoring, Social Autopilot, Asset / Image, Email Campaign, Print Copy |
| **Finance** | Invoice |
| **Clients** | Client Outreach, Client Research, Onboarding |

Two things to know about the roster:

- **The Support Concierge is the only agent a website visitor can reach.** It answers questions about your business and captures leads. It cannot change anything.
- **Every other agent is staff-only, and inherits your permissions.** An agent will not touch a tool you personally don't have access to — so a collaborator restricted to Blog can't reach the invoice agent by asking nicely.

## What the Agents Know About You

Agents read your **Business Profile** from Settings before writing anything:

- Business name, type, industry
- Services and pricing notes
- Location and service area
- Target audience
- Brand voice — e.g. "professional and friendly"

A thin business profile produces generic output. Filling it in properly is the single highest-value thing you can do for AI quality.

## Web Search

Agents can search the live web before writing, so drafts can reference current information rather than relying only on what the model was trained on. This matters most for blog posts and client research.

## Which AI Model Runs Your Agents

By default, everything runs on the platform's shared house model at no extra cost to you.

If you'd rather run on Claude, add your own **Anthropic API key** in the custom key vault (**Settings → Custom API Keys**, named `anthropic_api_key`). Your agents switch over automatically — no other setup. Usage is then billed by Anthropic directly to you.

Sensible defaults protect you either way: if the key is missing or stops working, agents fall back to the house model rather than failing.

## Agent Control

Agent Control at `/admin/chat` is where you manage the roster. It's an experimental feature, so it stays hidden until you enable it at `/admin/labs`, and it's restricted to the workspace owner and unrestricted admins.

From there you can:

- **See every agent** grouped by area, with a plain description of what each one does
- **Turn an individual agent off** if you never want it used
- **Set a workspace default** — which engine and model everything should use
- **Override a single agent** — for example, run the blog agent on a stronger model while everything else stays on the default

Settings inherit downward: an agent's own setting wins, then your workspace default, then the platform default. Leaving a field on "inherit" is the right answer most of the time.

The coordinator is listed separately. It doesn't produce content itself — it decides which agents to call — so only its model setting applies, and it defaults to a fast, inexpensive model because it runs on every single request.

## Practical Tips

- Describe the **outcome**, not the mechanism: "make the homepage feel more premium" works better than "change the theme tokens"
- Agents propose; you approve. Nothing is published to your public site without you saving it
- If output feels off-brand, fix the Business Profile before fighting with prompts
- Research-heavy requests take longer because the agent is genuinely searching first
