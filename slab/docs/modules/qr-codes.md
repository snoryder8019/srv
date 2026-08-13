# QR Codes & Card

Create branded QR codes and a digital business card at `/admin/qr-codes`.

## Creating a QR Link

Give the code a **label** so you can recognise it later, then pick where it points:

| Destination | What it links to |
|-------------|------------------|
| **Pages** | Any published page on your site |
| **Blog Posts** | Any published post |
| **Portfolio** | Your portfolio section |
| **Forms** | Any active form |
| **Custom URL** | Any web address you type |
| **Digital Business Card** | A card page Slab builds for you |

Only the sections you actually have content in will appear in the list.

**Codes point straight at their destination.** That means changing a link's address later will **not** update codes you've already printed — they still lead to the old page. Plan the destination before you print.

The exception is a **digital business card**: its address never changes, so you can redesign the card and update your details any time and printed codes keep working.

## Styling a Code

Click **Style** on any code to open the editor, which previews as you change things.

| Option | Choices |
|--------|---------|
| **Modules** | Square, dots, or rounded |
| **Fill** | Solid colour, or a linear or radial gradient |
| **Colour** | Any colour — defaults to your brand palette |
| **Centre logo** | Places your primary logo in the middle |
| **Phantom** | Melts the code into one of your brand images |
| **Visibility** | How strongly a phantom code stands out |

A few things are handled for you:

- The three corner squares always stay solid, even with dots or rounded modules, so the code keeps scanning reliably.
- Turning on a centre logo or phantom mode automatically raises the code's error correction to compensate.
- Phantom mode needs a background image selected, and stays deliberately subtle — a QR code needs real contrast to scan at all.

Always test a styled code with a phone before sending it to print.

## Downloading and Sharing

**Download PNG** gives you a 600 × 600 pixel image — about two inches at print resolution. PNG is the only format.

**Add to Footer** puts the code in your public website footer. **Copy URL** copies its destination.

For print-ready sizes and codes baked into flyers or business cards, use [Print Studio](print-studio.md) instead, which can embed any of your QR links.

## The Digital Business Card

Choosing **Digital Business Card** as a destination creates a shareable card page at `yourdomain.com/card/your-slug`.

### Setting it up

1. Create the QR link with the business card destination and pick a short slug.
2. Click **Design** on the card to choose a template and colour scheme.

Everything on the card is pulled from your existing brand settings — there are no separate fields to fill in. Your business name, tagline, phone, email, location, social links, and logo all come through automatically, so updating them in Settings updates the card.

### Templates

**Classic**, **Modern**, **Minimal**, **Cover**, **Dark**, and **Mono**.

### Colour schemes

**Brand colours** uses your own palette. The presets are **Midnight**, **Black & Gold**, **Forest**, **Ocean**, **Sunset**, **Plum**, and **Mono**.

### What visitors get

- Tappable phone, email, and website links
- Your social icons
- A QR code on the card itself, pointing at your website homepage
- A share button on phones that support it
- The option to add the card to their home screen like an app

Visitors can tap to call or email you, but there is no "save to contacts" download.

## Scan Tracking

Each digital business card counts how many times it has been opened, shown as a scan count in your list. Treat it as a rough indicator rather than an exact figure.

Other QR codes link directly to their destination, so their scans can't be counted. To measure traffic from a printed code, point it at a page you can track in your site analytics.
