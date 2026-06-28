# miSpy

## Overview
Offline mileage & expense tracker for Android. Pick how long to track (3h / 3.5h / 4h /
custom), optionally pin a start time, and miSpy records distance via GPS in the background
and auto-stops when the duration is reached. Log expenses, and see mileage converted to a
reimbursement/deduction value at a configurable per-mile rate. All data is stored on the
device — nothing is sent anywhere.

## Features
- Duration presets (3h, 3.5h, 4h, 4.5h, 5h) + custom minutes
- "Start now" or pin a future start time
- Background GPS tracking via a native foreground service (Android)
- Auto-stop at the chosen duration; trips persist as they run (crash-safe)
- Expense logging by category with a combined total
- Mileage value = miles × configurable rate
- Local-only storage (IndexedDB); JSON export

## Tech stack
Capacitor 6 · vanilla JS web UI (no build step) · @capgo/background-geolocation · IndexedDB

## Browser preview (test the UI now)
```bash
cd /srv/miSpy
PORT=3760 node serve.cjs        # open http://localhost:3760
```
In the browser the tracker uses the standard Geolocation API as a fallback, so distance
only accumulates while the tab is focused. Real background tracking is Android-only (below).

## Build the Android app
Requires Android Studio + JDK 17 on a machine with the Android SDK.
```bash
cd /srv/miSpy
npm install
npx cap add android        # creates the android/ project
npx cap sync               # copies www/ + installs native plugins
npx cap open android       # opens Android Studio -> Run / build APK
```

### Required Android permissions
`cap sync` pulls these in from the plugin, but confirm in `android/app/src/main/AndroidManifest.xml`:
- `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`
- `ACCESS_BACKGROUND_LOCATION`
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`
- `POST_NOTIFICATIONS` (Android 13+, for the persistent tracking notification)

On the device, grant location **"Allow all the time"** — "While using the app" stops GPS
when the screen is off.

## How it works
- `www/index.html` / `styles.css` — mobile UI (Track / Trips / Expenses / Settings)
- `www/tracker.js` — native plugin when on-device, Geolocation API in the browser;
  haversine distance with jitter (5 m) and accuracy (50 m) filtering
- `www/db.js` — IndexedDB stores: `trips`, `expenses`, `settings`
- `www/app.js` — controller: duration/pin logic, auto-stop, live stats, lists
- `serve.cjs` — dependency-free static server for previewing

## Known limitations / next steps
- A pinned start fires only while the app is open. Auto-starting at a future time with the
  app fully closed needs a native alarm (AlarmManager / WorkManager) — not in v1.
- Trips store the raw point array; for very long sessions consider trimming or downsampling.
- No map view yet (would need bundled/offline tiles to stay fully offline).

## Files
| File | Purpose |
| --- | --- |
| `capacitor.config.json` | App id `com.madladslab.mispy`, webDir `www`, legacy bridge on |
| `www/app.js` | Main controller |
| `www/tracker.js` | GPS / distance logic |
| `www/db.js` | Local storage |
| `serve.cjs` | Dev preview server |
