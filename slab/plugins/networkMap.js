/**
 * sLab Network — "who's on the network, and where" map data.
 *
 * Turns the three populations behind the hub into pins on the US basemap:
 *
 *   brand     — a network member (registry `tenants`, public.networkOptIn).
 *               PUBLIC by definition: named, linked, logo'd. Located from
 *               meta.businessState / brand.state (2-letter, authoritative — it's
 *               what the state-tax report bills against) with brand.location as
 *               the free-text refinement that gets us down to a city.
 *   delegate  — an ACTIVE sales delegate (registry `sales_delegates`). Has clean
 *               structured city/state from signup.
 *   waitlist  — an inference-mesh signup (registry `network_waitlist`).
 *
 * ── Privacy ────────────────────────────────────────────────────────────────
 * /network is a PUBLIC, unauthenticated page. Brands opted in to being listed
 * publicly; delegates and waitlist members did NOT — they signed up for a
 * commission program and an early-access list respectively. So people are
 * plotted ANONYMOUSLY: a dot carries a city/state label and nothing else. No
 * name, no email, no company, no id — none of it reaches the view, so none of it
 * can leak into HTML. Only `brand` pins are identified, because only brands
 * consented to that. Pending/suspended delegates are excluded entirely.
 *
 * If even an anonymous dot is too much, set PLOT_PEOPLE = false below: people
 * then contribute to the per-state choropleth counts only, and no individual
 * dot is emitted.
 *
 * ── International ──────────────────────────────────────────────────────────
 * US-only basemap for now. Anything that resolves as non-US is COUNTED
 * (`stats.international`) and surfaced as a note, never silently dropped and
 * never jammed onto a US coordinate. When the world map lands, branch on the
 * `scope` that geoUS.resolveLocation() already returns.
 */
import { getSlabDb } from './mongo.js';
import { resolveLocation, stateShapes, mapSize, dispersePins } from './geoUS.js';

const TRUE = 'true';
const PLOT_PEOPLE = true;    // false ⇒ delegates/waitlist count toward states but get no dot
const PIN_CAP = 1200;        // keep the SVG sane if the network gets big

/** Blank tally for one state. */
const emptyTally = () => ({ brand: 0, delegate: 0, waitlist: 0, total: 0 });

/**
 * @param {object[]} members - registry tenant docs already fetched by buildNetworkData
 * @returns {Promise<object>} map bundle for views/partials/_us-map.ejs
 */
export async function buildNetworkMap(members = []) {
  const slab = getSlabDb();

  // People come from the registry. Both reads are best-effort: the map is a
  // nice-to-have and must never be the reason /network 500s.
  const [delegates, waitlist] = await Promise.all([
    slab.collection('sales_delegates')
      .find({ status: 'active' })
      .project({ city: 1, state: 1 })            // never pull name/email — see Privacy above
      .limit(PIN_CAP).toArray().catch(() => []),
    slab.collection('network_waitlist')
      .find({})
      .project({ location: 1 })
      .limit(PIN_CAP).toArray().catch(() => []),
  ]);

  const pins = [];
  const byState = {};
  const stats = {
    brand: 0, delegate: 0, waitlist: 0,
    plotted: 0, international: 0, unknown: 0, states: 0,
  };

  const tally = (kind, state) => {
    stats[kind]++;
    if (!state) return;
    (byState[state] ||= emptyTally());
    byState[state][kind]++;
    byState[state].total++;
  };

  const add = (kind, geo, { label, sub, url } = {}) => {
    if (geo.scope === 'international') { stats.international++; stats[kind]++; return; }
    if (geo.scope !== 'us') { stats.unknown++; stats[kind]++; return; }
    tally(kind, geo.state);
    if (kind !== 'brand' && !PLOT_PEOPLE) return;
    if (pins.length >= PIN_CAP) return;
    pins.push({
      kind,
      x: geo.x, y: geo.y,
      state: geo.state,
      place: geo.label,               // "Austin, TX" — the only locality we expose
      precision: geo.precision,       // 'city' | 'state' (drives the "approx." hint)
      label: label || geo.label,
      sub: sub || '',
      url: url || null,
    });
  };

  // ── Brands: identified, linked. State code is authoritative; free text refines it.
  for (const t of members) {
    const brand = t.brand || {};
    const stateHint = (t.meta?.businessState || brand.state || '').trim();
    const geo = resolveLocation(brand.location || '', { state: stateHint });
    add('brand', geo, {
      label: brand.name || t.domain,
      sub: brand.industry || '',
      url: brand.customDomain || t.meta?.customDomain || t.domain ? tenantUrl(t) : null,
    });
  }

  // ── Delegates: anonymous dots. Structured city/state, so mostly city-precise.
  for (const d of delegates) {
    add('delegate', resolveLocation(d.city || '', { state: d.state || '' }));
  }

  // ── Waitlist: anonymous dots. `location` is optional and only exists on rows
  // captured after the map shipped — older rows land in stats.unknown, which is
  // honest rather than inventing a position from their IP.
  for (const w of waitlist) {
    add('waitlist', resolveLocation(w.location || ''));
  }

  dispersePins(pins);
  stats.plotted = pins.length;
  stats.states = Object.keys(byState).length;

  // Choropleth scale — states shade by how many network entities sit in them.
  const max = Object.values(byState).reduce((m, s) => Math.max(m, s.total), 0);
  const { width, height } = mapSize();

  return {
    width, height,
    states: stateShapes(),
    pins,
    byState,
    max,
    stats,
    plotPeople: PLOT_PEOPLE,
    // Hook for the international pass: the hub can already say "and N abroad".
    hasInternational: stats.international > 0,
  };
}

/** Same host precedence as tenantPublicUrl() in network.js. */
function tenantUrl(t) {
  const host = t?.meta?.customDomain || t?.public?.customDomain || t?.domain || '';
  return host ? 'https://' + host : null;
}
