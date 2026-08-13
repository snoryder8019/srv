/**
 * Field route math — dependency-free commute + ETA estimation.
 *
 * We deliberately avoid an external routing/geocoding API here: jobs carry an
 * optional `geo:{lat,lng}` pin (set from a tech's live GPS or entered by hand),
 * and we estimate drive time from great-circle distance inflated by a road
 * factor. It's an estimate, not turn-by-turn — good enough to sequence a day and
 * tell a client "~20 minutes out". Swap in a real routing key later without
 * touching callers.
 */

const EARTH_KM = 6371;
// Straight-line km underestimates road distance; ~1.3x is a common urban fudge.
const ROAD_FACTOR = 1.3;
// Assumed average door-to-door speed (km/h) incl. lights/parking.
const DEFAULT_SPEED_KMH = 38;

function toRad(d) { return (d * Math.PI) / 180; }

/** Great-circle distance between two {lat,lng} points, in km. */
export function haversineKm(a, b) {
  if (!a || !b || typeof a.lat !== 'number' || typeof b.lat !== 'number') return null;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_KM * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Estimated drive minutes between two points (null if either lacks a pin). */
export function commuteMinutes(a, b, speedKmh = DEFAULT_SPEED_KMH) {
  const km = haversineKm(a, b);
  if (km == null) return null;
  const roadKm = km * ROAD_FACTOR;
  return Math.max(1, Math.round((roadKm / speedKmh) * 60));
}

/** A pin from a job — prefers an explicit geo pin, falls back to a live ping. */
export function jobPin(job) {
  if (job?.geo && typeof job.geo.lat === 'number') return { lat: job.geo.lat, lng: job.geo.lng };
  if (job?.location && typeof job.location.lat === 'number') return { lat: job.location.lat, lng: job.location.lng };
  return null;
}

/**
 * Sequence a tech's jobs into a route with per-leg commute + cumulative arrival.
 * `jobs` should already be filtered to the tech/day and sorted by scheduledAt.
 * `start` is an optional {time:Date, pin:{lat,lng}} the tech departs from.
 * Returns { legs:[{job, pin, commuteFromPrev, arrive, depart}], totals }.
 */
export function buildRoute(jobs, start = {}) {
  const legs = [];
  let prevPin = start.pin || null;
  let clock = start.time ? new Date(start.time) : (jobs[0]?.scheduledAt ? new Date(jobs[0].scheduledAt) : null);
  let driveTotal = 0;
  let onSiteTotal = 0;

  for (const job of jobs) {
    const pin = jobPin(job);
    const commute = (prevPin && pin) ? commuteMinutes(prevPin, pin) : null;
    if (commute != null && clock) clock = new Date(clock.getTime() + commute * 60000);
    // Honor a later scheduled start if the tech would arrive early.
    if (job.scheduledAt && clock && new Date(job.scheduledAt) > clock) clock = new Date(job.scheduledAt);
    const arrive = clock ? new Date(clock) : null;
    const dwell = Number.isFinite(job.estimatedMinutes) ? job.estimatedMinutes : 0;
    const depart = arrive ? new Date(arrive.getTime() + dwell * 60000) : null;

    if (commute != null) driveTotal += commute;
    onSiteTotal += dwell;
    legs.push({ job, pin, commuteFromPrev: commute, arrive, depart });

    clock = depart || clock;
    if (pin) prevPin = pin;
  }

  return { legs, totals: { driveMinutes: driveTotal, onSiteMinutes: onSiteTotal, jobs: jobs.length } };
}

/**
 * ETA for arriving at `destPin` from `fromPin` right now.
 * Returns { minutes, arriveBy:Date } or null if a pin is missing.
 */
export function etaFrom(fromPin, destPin, now = null) {
  const minutes = commuteMinutes(fromPin, destPin);
  if (minutes == null) return null;
  const base = now ? new Date(now) : null;
  return { minutes, arriveBy: base ? new Date(base.getTime() + minutes * 60000) : null };
}
