# Recent Changes Summary

Generated: 2026-03-03T08:30:00.022Z

---

## GreeAlityTV — Neighborhoods, Local & Gigs Feature Drop (3/3/2026)

- **New models:** `grv_local` (Local directory listings) + `grv_gigs` (Gigs & Jobs board)
- **14 Greeley neighborhoods** hardcoded: Downtown, University District, Westlake, Island Grove, East Greeley, North Greeley, South Greeley, Bittersweet, Country Club, Poudre River, Alta Vista, West Side, Sunrise, Prairie West
- **`/local`** — interactive Leaflet/OpenStreetMap neighborhood map with clickable zones, category tabs (Food / Businesses / Services / Food Trucks), user-submission flow with S3 image upload
- **`/gigs`** — Gigs & Jobs board with type/category/neighborhood filtering, remote flag, expiry date
- **Cookie consent banner** — bottom-fixed, localStorage-backed, Accept/Decline
- **Admin dashboard** expanded — 6 stats cards, management nav buttons (Local / Gigs / Users)
- **`/admin/local`** — full listing management: status filter bar, inline Approve/Reject/Reset via AJAX, Delete
- **`/admin/gigs`** — full gigs management: type + category filters, inline status management via AJAX
- **`PUT /admin/local/:id/status`** + **`PUT /admin/gigs/:id/status`** — JSON APIs for inline admin updates
- **CHANGELOG.md** created at `/srv/greealitytv/CHANGELOG.md`

**Files changed:** 14 new, 7 modified (models, routes, views, CSS, JS)

---

## Commit: good push

- **Hash:** `31cf8b3`
- **Author:** Scott
- **Date:** 2/25/2026
- **Changes:** 51 files, +6048/-36 lines

### Modified Areas:

**Backend:** 7 files
**Views:** 22 files
**Documentation:** 5 files

---

## Commit: stable commit

- **Hash:** `ae369f5`
- **Author:** Scott
- **Date:** 2/22/2026
- **Changes:** 74 files, +10482/-765 lines

### Modified Areas:

**Frontend:** 1 files
**Backend:** 10 files
**Views:** 24 files
**Documentation:** 13 files

---

## Commit: risky push

- **Hash:** `f6e1caf`
- **Author:** Scott
- **Date:** 2/16/2026
- **Changes:** 66 files, +10662/-407 lines

### Modified Areas:

**Frontend:** 2 files
**Backend:** 13 files
**Views:** 21 files
**Scripts:** 3 files
**Documentation:** 7 files

---

## Commit: good push

- **Hash:** `27034f4`
- **Author:** Scott
- **Date:** 11/8/2025
- **Changes:** 106 files, +17543/-426 lines

### Modified Areas:

**Frontend:** 4 files
**Backend:** 23 files
**Views:** 18 files
**Scripts:** 1 files
**Documentation:** 16 files

---

## Commit: services proxies and domains fixed in etc

- **Hash:** `c30f611`
- **Author:** Scott
- **Date:** 11/7/2025
- **Changes:** 55 files, +17912/-204 lines

### Modified Areas:

**Frontend:** 2 files
**Backend:** 6 files
**Views:** 7 files
**Scripts:** 6 files
**Documentation:** 21 files

---

