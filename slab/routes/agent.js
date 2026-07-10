/**
 * Slab — Public agent endpoint
 * Mounted OUTSIDE /admin at /agent, so it's reachable by unauthed visitors.
 * Currently only serves audience-scoped suggestions. Any future public agent
 * actions MUST route through agentAudience (public tier = assist + inquiry only).
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/config.js';
import { resolveAudience, suggestionsFor } from '../plugins/agentAudience.js';

const router = express.Router();

// Derive the viewer's audience from the admin JWT cookie if present, else public.
function audienceFromReq(req) {
  let user = null, ctx = {};
  try {
    const m = (req.headers.cookie || '').match(/slab_token=([^;]+)/);
    if (m) {
      const d = jwt.verify(m[1], config.JWT_SECRET);
      if (d?.isAdmin || d?.id) {
        user = d;
        ctx = {
          isSuperAdmin: !!d.isSuperAdmin,
          isOwner: !!d.isOwner,
          userPermissions: Array.isArray(d.permissions) ? d.permissions : [],
        };
      }
    }
  } catch { /* invalid/expired cookie → treat as public */ }
  return { audience: resolveAudience(user, ctx), ctx };
}

// GET /agent/suggestions — safe for unauthed calls.
router.get('/suggestions', (req, res) => {
  try {
    const { audience, ctx } = audienceFromReq(req);
    const brand = req.tenant?.brand || {};
    res.json({ ok: true, audience, suggestions: suggestionsFor(audience, brand, ctx, 4) });
  } catch {
    res.json({ ok: false, suggestions: [] });
  }
});

export default router;
