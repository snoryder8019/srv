# In the Field

Run on-site jobs from your phone at `/admin/field`.

**In the Field is an experimental feature.** It stays hidden until you switch it on at `/admin/labs`. Once enabled, it appears under Clients & CRM in the sidebar.

It is built for work that happens away from the desk — service calls, installs, inspections, estimates. Dispatch a technician, track them on a map, capture the quote and the signature on site, and give the customer a single link to follow along and pay.

## Setting Up Technicians
Any staff member can be marked as a field technician on the dispatch board. Only flagged technicians can be assigned to jobs or appear in the route planner.

Technicians use the same admin sign-in as everyone else — there is no separate app. The job pages are built to work on a phone.

## The Dispatch Board
The board lists every open job with its client, assigned staff, address, scheduled time, and status.

| Status | Meaning |
|--------|---------|
| Scheduled | Booked, not started |
| En route | Technician is travelling |
| On site | Technician has arrived |
| Complete | Work finished |
| Canceled | Called off — hidden from the board |

Create a job with a title, client, assigned technician, address, scheduled time, and an estimated duration in minutes. The duration feeds the route planner, so it is worth filling in.

---

## The Job Page
Everything that happens on site is captured from the job's own page.

### Live Location
The job page carries a map. A technician taps **Share location** and their device starts broadcasting; anyone else with the job open watches them move in real time. The last known position is stored, so opening the page later still shows where they were and when.

Sharing is manual and per-job — nothing is tracked until a technician turns it on, and it is staff-only.

### Site Location
Pin the job site by entering coordinates, or tap to use the technician's current position while standing on site. The pin is what ETA and route estimates are measured against, so a job without a pin can't produce either.

### ETA to the Client
With a pin set and live sharing running, **Report ETA** works out how far the technician is from the site and how long they are likely to be. Tick the notify box and the client is emailed a short "on our way, about N minutes out" message with an arrival time.

Estimates are based on distance and an average driving speed — good enough to set expectations, not turn-by-turn navigation.

### On-Site Notes
Add timestamped notes as the job progresses. Each one records who wrote it and when.

### Quotes
**Create quote** raises a draft engagement for the job's client, pre-titled with the job, and drops you into the standard quote editor. Build it, send it, and the client signs it the usual way. The job needs a client assigned before you can quote it.

### File Uploads
Attach photos, PDFs, and signed paperwork — up to 12 MB per file. Uploads are stored privately and are only ever viewable by signed-in staff. They never get a public link.

### Signature Waivers
Capture a signature on the screen. Enter a label for what is being signed and the name of the person signing, have them sign with a finger, and save. The signature image is stored privately alongside who signed it and when.

---

## Route Planner
Open the route planner, pick a technician and a date, and Slab sequences their jobs for the day. Each stop shows the estimated drive from the previous one, an arrival time, and a departure time based on the job's estimated duration. Totals for driving time, on-site time, and number of jobs sit at the top.

A stop scheduled for later than the technician would arrive keeps its booked time — the planner won't move an appointment earlier. Jobs without a location pin appear in the list but can't contribute a drive estimate.

## The Client Link
**Send client link** emails the client a private link to their own page for this job. No password, no account — the link itself is the key, and it expires after 14 days.

On that page the client can:

- see the job and its current status, and the technician's latest ETA
- review and sign their quote, if one has been sent
- view and pay any outstanding invoices

Sending the link again while it is still valid re-sends the same link rather than invalidating the one the client already has. The client needs an email address on their record.
