# GreeAlityTV — Changelog

## 2026-03-03 — Neighborhoods, Local, Gigs & Admin Expansion

### New Features

#### Neighborhoods
- Hardcoded 14 Greeley, CO neighborhoods used as a shared enum across `Local` and `Gig` models:
  Downtown, University District, Westlake, Island Grove, East Greeley, North Greeley, South Greeley,
  Bittersweet, Country Club, Poudre River, Alta Vista, West Side, Sunrise, Prairie West

#### `/local` — Local Greeley Directory
- New page browsable without login; submission requires sign-in
- Categories: Food, Businesses, Services, Food Trucks
- **Leaflet.js + OpenStreetMap** interactive neighborhood map — no Google Maps required
  - 14 neighborhood circles rendered with listing counts as tooltips
  - Click any circle or chip to filter listings below in real-time
- Category tab bar: All | Food | Businesses | Services | Food Trucks
- Submission form with image upload (Linode S3), hours, phone, website, address
- All submissions start as `pending` and require admin approval before appearing

#### `/gigs` — Gigs & Jobs Board
- New page for short-term gigs and regular job postings from the community
- Types: Gig (one-off) / Job (regular position)
- 12 categories: Tech, Food & Restaurant, Retail, Construction, Healthcare, Education, Automotive, Creative, Events, Lawn & Home, General Labor, Other
- Filters: Type (Gig/Job), Category, Neighborhood — all client-side, no page reload
- Remote flag + expiration date fields
- All submissions require admin approval

#### Cookie Consent Banner
- Fixed bottom banner on first visit using `localStorage` key `grv_cookie_consent`
- Accept / Decline buttons; choice persists across sessions
- Slides in with animation, dismisses smoothly on choice

### Admin Panel Expansion

#### Dashboard updates
- **Stats grid** expanded to 6 cards: added Local Listings (approved/total) + Gigs/Jobs (approved/total)
- **Management nav** added to header: Local Listings, Gigs & Jobs, Users buttons
- Pending queue now includes Local Listings and Gigs & Jobs approval tables

#### New management pages
- **`/admin/local`** — Full local listings management
  - Filter by status (All/Pending/Approved/Rejected), Category, Neighborhood
  - Inline status toggle: Approve, Reject, Reset to Pending — no page reload via AJAX
  - Delete with confirmation
- **`/admin/gigs`** — Full gigs & jobs management
  - Filter by status, Type (Gig/Job), Category
  - Inline status toggle: Approve, Reject, Reset — no page reload via AJAX
  - Shows pay, contact, expiry, remote flag
  - Delete with confirmation

### Data Models

#### `grv_local` collection (`models/Local.js`)
| Field | Type | Notes |
|---|---|---|
| name | String | required |
| category | Enum | food, business, service, food-truck |
| neighborhood | Enum | one of 14 Greeley neighborhoods |
| address | String | optional |
| description | String | required |
| website | String | optional |
| phone | String | optional |
| hours | String | optional |
| image | String | S3 URL, optional |
| submittedBy | ObjectId | ref GrvUser |
| status | Enum | pending → approved/rejected |

#### `grv_gigs` collection (`models/Gig.js`)
| Field | Type | Notes |
|---|---|---|
| title | String | required |
| type | Enum | gig, job |
| category | String | one of 12 categories |
| company | String | optional |
| description | String | required |
| pay | String | optional, free text |
| contact | String | required, email/phone/URL |
| neighborhood | String | optional |
| isRemote | Boolean | default false |
| expiresAt | Date | optional |
| submittedBy | ObjectId | ref GrvUser |
| status | Enum | pending → approved/rejected |

### Routes Added
| Method | Path | Description |
|---|---|---|
| GET | /local | Public local directory + Leaflet map |
| GET | /local/new | Submission form (auth required) |
| POST | /local | Submit listing (auth required) |
| GET | /gigs | Public gigs & jobs board |
| GET | /gigs/new | Submission form (auth required) |
| POST | /gigs | Submit posting (auth required) |
| GET | /admin/local | Admin: manage all local listings |
| GET | /admin/gigs | Admin: manage all gigs/jobs |
| POST | /admin/local/:id/approve | Approve local listing |
| POST | /admin/local/:id/reject | Reject local listing |
| DELETE | /admin/local/:id | Delete local listing |
| PUT | /admin/local/:id/status | Inline status change (JSON API) |
| POST | /admin/gigs/:id/approve | Approve gig/job |
| POST | /admin/gigs/:id/reject | Reject gig/job |
| DELETE | /admin/gigs/:id | Delete gig/job |
| PUT | /admin/gigs/:id/status | Inline status change (JSON API) |

---

## Earlier History

See git log for commits prior to 2026-03-03. All content models follow the `grv_` collection prefix convention and use the same pending → admin approval → published flow established with Posts and Videos.
