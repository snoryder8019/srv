# Social Media

Compose, schedule, and publish to your social networks at `/admin/social`.

## Tabs

| Tab | What it's for |
|-----|---------------|
| **Compose** | Write a post, attach media, publish or schedule it |
| **Agent Studio** | AI drafting, your Voice Profile, and the review queue |
| **Calendar** | Month view of everything scheduled |
| **Posts** | Every post with its status, plus an archive |
| **Analytics** | Follower and engagement figures per network |

Accounts are connected under **Settings → Social Media**, not in this section.

## Connecting Networks

Some networks connect with a single sign-in button. The rest need a key or token pasted in.

| Network | How you connect |
|---------|-----------------|
| Facebook Page | Sign in with Facebook |
| Instagram | Links itself once Facebook is connected |
| Threads | Sign in with Threads |
| LinkedIn | Sign in with LinkedIn |
| Google Business | Sign in with Google |
| Mastodon | Instance address and access token |
| Bluesky | Handle and app password |
| Discord | Channel webhook address |
| Telegram | Bot token and channel ID |
| X (Twitter) | Access token — text only, no images |
| Reddit | App credentials and target subreddit |

**YouTube** can be connected for analytics only — video publishing isn't available yet. **TikTok** and **Pinterest** appear with a "Soon" badge and can't be saved or posted to.

Facebook, Instagram, and Threads all run through one Meta app, so you set that up once.

## Writing a Post

- **Post text** — up to 5,000 characters
- **Link** — optional
- **Media** — paste image links, upload, pick from Assets, or generate one
- **Format** — single post, carousel, or story
- **Post to** — tick each network; unconnected ones are greyed out

**✦ Write with AI** drafts the text for you from a short brief.

### Limits worth knowing

- The character counter warns above **280** so your text still fits X. Longer posts are allowed — each network trims to its own limit when publishing.
- A single post takes up to **4** images; carousels and stories take up to **10**.
- **Instagram always needs an image or video.** A post without one will fail.
- Carousels go to Instagram and Threads only. Stories go to **Instagram only**.

## Scheduling

Pick a date and time, or use **⚡ Auto-slot** to drop the post into the next free slot. Auto-slot uses **9am, 1pm, and 6pm**, filling a day before moving to the next, and staggers a multi-network post so they don't all fire at once.

The scheduler checks for due posts **every minute**, and anything overdue publishes on the next check rather than being skipped.

A post moves through **draft → scheduled → publishing → published**. It ends as **partial** if some networks succeeded and others failed, or **failed** if none did. Deleting a post archives it; permanent deletion is offered from the archived view.

## Autopilot

Found under **Agent Studio → 🛩️ Autopilot**, this generates posts for you on a repeating cadence. It writes copy in your brand voice, builds the image, and works in upcoming holidays and retail dates.

- **Cadence** — off, daily, 3× per week, or weekly
- **Posts per run** — 1 to 10
- **Standing prompt** — a sentence describing what you want posted about
- **Follow your site** — pull from your blog, portfolio, or open job listings
- **Asset tags** — use tagged images from your library as backgrounds

**Nothing goes out without you by default.** Drafts land in the review queue for approval. Turning on **Auto-slot** puts them on the calendar so you can cancel before they fire. Only **Auto-publish** skips review entirely.

## Agent Studio

- **Voice Profile** — a short Q&A teaching the AI your tone, phrases to use, and things to avoid. Every edit you make to AI copy is saved as an example, so it drifts toward how you actually write.
- **Review queue** — approve, edit, schedule, or dismiss pending drafts.
- **Learning** — thumbs up or down on a layout steers future designs. A reliability figure grows as more of your live posts are scored on real engagement.
- **Batch, Story, and Carousel builders** — generate a run of posts, a 2–8 frame story, or a seamless multi-slide carousel. These run in the background and never post on their own.

## Analytics

Live figures come from **Facebook, Instagram, Threads, LinkedIn, Bluesky, and YouTube**. Other networks don't publish an analytics API, so they won't appear.

The tiles across the top show **Total Followers, Reach, Impressions, Engagements, and Posts**, with a trend line per network below.

**Reach is Instagram-only.** Facebook removed its reach metric, and the other networks have no equivalent, so Instagram is the only source. If you haven't connected Instagram, the Reach tile stays at **0** no matter how well the others do. If it shows a dash instead, Instagram refused the request — reconnect it and grant the insights permission.

LinkedIn analytics need an organization page; personal profiles aren't supported.

## The 9-Grid Mural

A mural is one large picture cut into nine posts that reassemble into a single image on your Instagram profile grid. You build it in the Asset Generator at `/admin/assets/social` using the **⊞ 9-Grid** button.

### How it's built

Instagram crops profile-grid thumbnails to a **4:5 portrait** shape, so a square design loses its left and right edges. Slab designs at that crop instead, then pads each tile back out to a square with softly blurred, darkened side margins. The grid shows exactly what you designed, and the post still looks like a deliberately framed square when someone taps it.

Horizontal and vertical lines cross tiles cleanly. **Diagonals and text spanning two tiles will break at the seams** — keep text inside a single tile.

### Reverse scheduling

Instagram fills the grid newest-first from the top left, so the mural publishes backwards. The **bottom-right tile goes out first** and the **top-left goes last**, carrying the full caption and hashtags. The other eight get a short line each, all editable first.

Tiles are spaced **90 seconds** apart by default, with a **60 second** minimum. A full mural takes about twelve minutes.

### Daily cap

**Four murals per rolling 24 hours.** That's already 36 posts in a day. Beyond it you risk Instagram's spam filters, and there's no benefit — only one mural can sit at the top of your grid at a time.

### Grid lock

Publishing a mural switches on **grid lock** automatically, and a banner appears on the Calendar tab.

Your profile grid is three columns wide and reflows as you post. Adding one or two posts above a mural shifts every tile sideways and scrambles the picture. Adding exactly **three** pushes the mural down a row but keeps each tile in its column, so the image survives.

While grid lock is on:

- New Instagram feed posts are **held** rather than published.
- As soon as **three** are waiting, they publish together as a complete row. Leftovers keep waiting for a third.
- If a held post was also going to other networks, **those go out on time** — only the Instagram half waits.
- Instagram **Stories** are unaffected, since they never appear on the grid.

The banner shows how many posts are held and how many more complete the next row. **Turn off protection** releases everything held on the next cycle, which may pull your mural out of alignment.

In your lists the nine tiles collapse into one card showing progress, and archiving the mural clears all nine from the queue at once. Tiles already live on Instagram stay up.

A mural needs a connected Instagram account. Connect your accounts and set up an AI provider under [Settings](../platform/settings.md).
