# Marketplace

Sell products or services from your site at `/admin/marketplace`.

Listings appear publicly at `/marketplace`, and each one gets its own page at `/marketplace/{slug}`.

## Turning the Storefront On

Creating listings is not enough on its own — the public storefront is **off by default**.

1. Add at least one listing and set its status to **Active**.
2. Go to **Design & Copy** → **Content** tab → **Section Visibility** and switch **Marketplace** on.

Until that toggle is on, `/marketplace` returns a "not found" page even though your listings exist.

## Creating a Listing

| Field | Notes |
|-------|-------|
| Title | Required. Sets the page address, which never changes afterward |
| Type | Product or Service — controls the default button label |
| Category | Free text. Shown above the title as a small label |
| Price ($) | Leave blank to show "Contact for pricing" |
| Price Unit | e.g. `hour`, `month`, `project` — renders as `$85 / hour` |
| Summary | One line, shown on the grid cards |
| Description | Longer plain-text detail, shown on the listing page only |
| Contact / Buy Link | Where the button sends people |
| Button Label | Defaults to "Buy Now" for products, "Inquire" for services |
| Location | Optional, shown in the listing's detail line |
| Tags | Comma-separated, shown as pills on the listing page |

**Important:** the page address is generated from the title when you first create the listing and is permanent. Renaming a listing later does not change its URL.

**Also important:** if you leave **Contact / Buy Link** empty, no button renders at all and the listing becomes information-only. Point it at an email address, a phone number, a full web address, or an internal path like `/#contact`.

## Images

Each listing holds one image. Upload a file (images only, up to 20 MB) or paste an image address instead.

Grid cards crop to a 4:3 shape from the center, so upload something close to that ratio if the framing matters. The listing page shows the full uncropped image.

## Statuses

| Status | Effect |
|--------|--------|
| Draft | Hidden from the public site. The default for a new listing |
| Active | Live and visible |
| Sold | Removed from the public site |
| Archived | Removed from the public site |

Only **Active** listings are ever public — there is no preview link for a draft. From the listings table you can one-click **Activate** or **Mark Sold**; moving a listing back to Draft or Archived is done from the edit form.

## Ordering and Layout

Listings sort featured-first, then by the order they were created. Tick **Featured** on a listing to pin it to the top of the grid and give its card a "Featured" ribbon.

Under **Design & Copy** → **Design** tab you can set the public page's heading and subheading, choose 2, 3, or 4 grid columns, and hide prices sitewide.

## Putting Listings on Other Pages

Marketplace is available as a content source in the Pages builder. Add a **Data List** block to any page, choose **Marketplace** as its source, and optionally filter to a single category. See [Pages](pages.md).

## sLab Network

Active listings can also be syndicated to the shared sLab Network hub. Three switches must all be on:

1. **Join the sLab Network** — at `/admin/settings`
2. **Syndicate my marketplace** — at `/admin/settings`
3. **Share to sLab Network** — on the individual listing (on by default)

Note that the Network hub always displays prices, even if you have hidden them on your own site.

## Limits

- One image per listing — there is no gallery
- Descriptions are plain text, not rich HTML
- Prices display in US dollars
- Categories and tags are labels only — visitors cannot filter or search by them
- There is no cart or checkout. Every listing sends people to the link you supply
