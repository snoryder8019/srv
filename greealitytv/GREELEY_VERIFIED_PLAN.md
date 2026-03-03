# Greeley Verified — Feature Plan

**Status:** In Progress — Payment workflow TBD, executing tomorrow
**Last Updated:** 2026-03-03

---

## Overview

**Greeley Verified** is a community trust badge — a gold checkmark (✓) displayed next to a user's name across the platform. It signals that the person is a verified Greeley, Evans, or Eaton resident.

Verification costs **$2.50**, paid online. After payment, a postcard is mailed to their local address. The postcard contains a unique confirmation code. The user enters that code on the platform to activate their badge.

**Admins are auto-verified.** They receive the checkmark immediately upon being granted admin status.

---

## Where the Checkmark Appears

| Location | Notes |
|---|---|
| Nav bar (next to username) | Small inline checkmark |
| My Profile page (`/profile`) | Below display name |
| Public Profile page (`/profile/:id`) | Below display name |
| Article byline (`/posts/:id`) | Next to author name |
| Video byline (`/videos/:id`) | Next to author name |
| Comment author display | Next to commenter name |
| Admin user list | In user table |

---

## Eligible Addresses

Mail delivery is restricted to:

- **Greeley, CO** — ZIP codes: 80631, 80634, 80638, 80639
- **Evans, CO** — ZIP code: 80620
- **Eaton, CO** — ZIP code: 80615

Frontend: City dropdown restricted to these three cities.
Backend: Validate city AND zip code on submission.

---

## User Flow

```
1. User clicks "Get Verified" on their profile or a prompt
       ↓
2. /verify/apply — Address form (name, street, city, zip)
       ↓
3. /verify/pay — Payment page ($2.50)
       [Payment workflow — finalized tomorrow]
       ↓
4. Payment confirmed → VerificationRequest created (status: paid)
   Flash: "Postcard on the way! Check your mail in 3–7 days."
       ↓
5. Admin sees request in /admin/verifications queue
   Admin marks as "mailed" (triggers email or note)
       ↓
6. User receives physical postcard with unique 6-digit code
       ↓
7. User visits /verify/confirm — enters their code
       ↓
8. Code matches → user.isVerified = true → badge appears everywhere
```

---

## Database Schema

### User model additions

```js
isVerified: { type: Boolean, default: false }
```

### VerificationRequest model (`grv_verifications` collection)

```js
{
  user: { type: ObjectId, ref: 'GrvUser', required: true },

  // Address
  streetAddress: { type: String, required: true },
  city: { type: String, required: true, enum: ['Greeley', 'Evans', 'Eaton'] },
  state: { type: String, default: 'CO' },
  zip: { type: String, required: true },

  // Verification code (mailed on postcard)
  code: { type: String },           // 6-digit alphanumeric, set when admin mails
  codeExpiresAt: { type: Date },    // 30 days from mailing date

  // Payment
  paymentStatus: { type: String, enum: ['pending', 'paid', 'refunded'], default: 'pending' },
  paymentId: { type: String },      // Stripe payment intent ID
  amountPaid: { type: Number },     // in cents (250)

  // Status flow
  status: {
    type: String,
    enum: ['pending_payment', 'paid', 'mailed', 'verified', 'expired', 'rejected'],
    default: 'pending_payment'
  },

  // Timestamps
  submittedAt: { type: Date, default: Date.now },
  paidAt: { type: Date },
  mailedAt: { type: Date },
  verifiedAt: { type: Date }
}
```

---

## File Structure

```
greealitytv/
├── models/
│   └── VerificationRequest.js       ← NEW (stub created)
├── routes/
│   └── verify.js                    ← NEW (stub created)
├── views/
│   └── verify/
│       ├── apply.ejs                ← NEW — address + payment form
│       ├── pending.ejs              ← NEW — "postcard on the way" status page
│       └── confirm.ejs              ← NEW — enter code from postcard
│   └── admin/
│       └── verifications.ejs        ← NEW — admin queue: mail postcards, mark mailed
├── public/
│   └── css/style.css                ← MODIFIED — .verified-badge, .verified-check CSS
├── views/partials/
│   └── nav.ejs                      ← MODIFIED — checkmark in nav for verified/admin
├── views/profile/
│   ├── me.ejs                       ← MODIFIED — checkmark on own profile
│   └── show.ejs                     ← MODIFIED — checkmark on public profile
├── views/posts/
│   └── show.ejs                     ← MODIFIED — checkmark in article byline
├── views/videos/
│   └── show.ejs                     ← MODIFIED — checkmark in video byline
├── GREELEY_VERIFIED_PLAN.md         ← THIS FILE
```

---

## Routes

```
GET  /verify/apply       → address form (requires auth, not already verified)
POST /verify/apply       → validate address, redirect to payment
GET  /verify/pay         → payment page (requires pending verification request)
POST /verify/pay         → process payment (Stripe webhook target)
GET  /verify/confirm     → enter postcard code
POST /verify/confirm     → validate code, activate badge if correct

GET  /admin/verifications            → list all pending/mailed requests
POST /admin/verifications/:id/mail   → mark as mailed, generate + store code
POST /admin/verifications/:id/reject → reject request, flag for refund
```

---

## Payment Workflow (TODO — finalize tomorrow)

**Options to evaluate:**
1. **Stripe Checkout** — hosted payment page, easiest integration, handles everything
2. **Stripe Payment Intents** — custom UI, more control, requires more code
3. **Venmo/Cash App QR** — manual, no automation, not recommended

**Recommended:** Stripe Checkout at $2.50 USD
- Create a Stripe product: "Greeley Verified Postcard" at $2.50
- Webhook on `checkout.session.completed` → update VerificationRequest status
- Metadata: `{ userId, verificationRequestId }`

**ENV vars needed:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...   (the $2.50 product price ID)
```

**npm package to add:**
```
npm install stripe
```

---

## Admin Postcard Workflow

1. Admin visits `/admin/verifications`
2. Table shows: user name, address, payment status, current status
3. For `paid` requests, admin sees **"Mark as Mailed"** button
4. Clicking it:
   - Generates a unique 6-character alphanumeric code (e.g. `GRV-4X9`)
   - Sets `status = 'mailed'`, `mailedAt = now`, `codeExpiresAt = now + 30 days`
   - Saves code to DB (hashed or plaintext — plaintext is fine for this scale)
5. Admin physically mails postcard with that code to the address shown
6. User enters code at `/verify/confirm` → badge activates

**Physical postcard copy (draft):**
> Welcome to Greeley Verified!
> Your code: **GRV-4X9**
> Enter it at: greealitytv.com/verify/confirm
> Expires in 30 days.
> — GreeAlityTV, Your Greeley Community Voice

---

## UI Design

### Verified Checkmark Badge
- Gold circle with white checkmark SVG
- 16x16px inline next to names
- CSS class: `.verified-check`
- Tooltip: "Greeley Verified"

### Verified check SVG (inline)
```html
<span class="verified-check" title="Greeley Verified">
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="8" fill="#F4A261"/>
    <path d="M4.5 8l2.5 2.5 4.5-5" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
</span>
```

---

## Implementation Phases

### Phase 1 — Today (Foundation)
- [x] Plan document created
- [x] File structure scaffolded (stub files)
- [x] `isVerified` field added to User model
- [x] VerificationRequest model stub created
- [x] Verified checkmark CSS added
- [x] Checkmark shown for **Admin users** in nav, profiles, bylines

### Phase 2 — Tomorrow (Payment + Full Flow)
- [ ] Stripe integration (`npm install stripe`)
- [ ] Address form + validation (`/verify/apply`)
- [ ] Stripe Checkout session creation (`/verify/pay`)
- [ ] Stripe webhook handler (update request status on payment)
- [ ] Code confirmation route (`/verify/confirm`)
- [ ] Admin verifications queue view + "Mark Mailed" action
- [ ] Email notification (optional: notify user when postcard is mailed)
- [ ] Wire up checkmark to `isVerified` field (not just `isAdmin`)
- [ ] Add "Get Verified" prompt to profile pages for unverified users

### Phase 3 — Polish
- [ ] Expiration handling (code expired → prompt to reapply)
- [ ] Refund workflow for rejected requests
- [ ] Admin dashboard stats card for verifications
- [ ] Verification badge on nav hover tooltip

---

## Notes & Decisions

- **One request per user** — enforce at route level (check for existing non-rejected request)
- **Code format** — `GRV-XXXX` (4 random uppercase alphanumeric) — simple, memorable, fits postcard
- **Postcard fulfillment** — manual by admin (no print API needed at this scale)
- **$2.50 covers** postcard printing + stamp (~$0.60 stamp + ~$1.40 print + margin)
- **isAdmin implies isVerified** — show checkmark to all admins automatically, no separate request needed
