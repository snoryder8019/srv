# Pages

Create custom pages at `/admin/pages`. Pages live at `/{slug}` on your public site.

Every page is built the same way: a stack of blocks, top to bottom. There are no longer separate page types to choose between — you add whatever mix of blocks the page needs.

## Building a Page

1. Give the page a **Page Title** and, optionally, a **URL Slug** (one is generated from the title if you leave it blank).
2. Click block types in the **Add Block** palette to append them to the page.
3. Fill in each block's fields.
4. Drag a block by its handle to reorder it, or remove it entirely.
5. Set **Status** to Published when you're ready.

A few slugs are reserved and cannot be used: `blog`, `newsletter`, `help`, `admin`, `auth`, and `sitemap.xml`.

## Block Types

| Block | What it is |
|-------|-----------|
| Hero Banner | Full-width opening banner with heading, subheading, and a button |
| Text Section | Heading, subheading, and body copy |
| Split Layout | Text and an image side by side, with a button |
| Call to Action | Bold banner with a heading and button |
| Feature Cards | Intro plus up to four cards |
| FAQ Accordion | Expandable question-and-answer pairs |
| Pricing Table | Tiered pricing columns |
| Testimonials | Quotes with names and roles |
| Stats Row | A row of numbers with labels |
| Ticker / Marquee | Scrolling text bar |
| HTML Block | Free-form HTML, for long-form prose or anything custom |
| Data List | Pulls in live content from another module |

**HTML** and **Data List** used to be whole page modes of their own. They are now simply block types, which means a single page can mix prose, a live listing, and visual sections together.

## Data List Blocks

A Data List block pipes another module's published content into the page. It reads that content — it never changes it, and the module stays the place you manage it.

| Source | Shows |
|--------|-------|
| Blog Posts | Published blog posts |
| Newsletter | Published newsletter issues |
| Help Articles | Published help articles |
| Portfolio | Portfolio items, opened in a pop-up |
| Careers / Jobs | Open job postings |
| Marketplace | Active marketplace listings |

Each block takes an optional heading, an items-per-page count, and a pagination toggle. Portfolio, Careers, and Marketplace also accept a **Group Filter** so you can show one category, department, or group instead of everything.

## Inline Module Pipes

Inside an HTML block you can drop a compact list of another module's content with a pipe:

`{{module "blog" limit=3}}`

The source names are the same ones the Data List block offers. This is useful when you want a short list mid-paragraph rather than a full section.

## Images

Blocks with image slots let you upload or pick an image per slot — hero and banner backgrounds, split-layout images, card images, and testimonial avatars.

## SEO Fields

Each page carries its own meta title, meta description, robots directive, sitemap priority, change frequency, canonical URL, and share (Open Graph) image.

## Navigation

Tick **Show in Nav** to add the page to your site's navigation bar.

## AI Agent

The Page Agent builds a whole page from a description. It writes the copy, proposes a block layout, fills in the SEO fields, and can generate images for the blocks that need them. Review what it produces before publishing — it is a starting point, not a finished page.

## Older Pages

Pages built before the builder was unified still work and still render. When you open one for editing it appears as blocks automatically — an old content page becomes a single HTML block, an old data-list page becomes a single Data List block. Nothing is converted until you save, so opening an old page to look at it changes nothing.
