// pitchLoader — thin compatibility shim over the unified data store (lib/store.js).
// Existing renderers (routes/clients.js, routes/admin.js) import getPitch /
// listPitches / getView from here; the actual filesystem lives in store.js,
// which reads BOTH the user pitch store and the legacy seeded pitches.
import { getPitch, listPitches } from './store.js';

export { getPitch, listPitches };

export function getView(pitch, viewSlug) {
  if (!pitch?.views) return null;
  return pitch.views.find((v) => v.slug === viewSlug) || null;
}
