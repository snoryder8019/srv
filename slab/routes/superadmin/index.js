// /superadmin — composed router. Split from a 2,827-line single file into a
// shared helper module + focused feature routers (extract-and-shim).
//
// SECURITY: the requireSuperAdmin gate ordering is preserved verbatim — public
// routes mount BEFORE the gate; every protected router (and the scottsGateway
// mount) mounts AFTER it. Do not reorder these three blocks.
import express from 'express';
import scottsGatewayRouter from './scottsGateway.js';
import { requireSuperAdmin } from '../../middleware/superadmin.js';
import publicRoutes from './pub.js';
import dashboard from './dashboard.js';
import tenants from './tenants.js';
import ollama from './ollama.js';
import ops from './ops.js';
import tickets from './tickets.js';
import users from './users.js';
import crossapp from './crossapp.js';
import announcements from './announcements.js';
import gftv from './gftv.js';
import monitoring from './monitoring.js';

const router = express.Router();

// ── Pre-auth (login, subscribe, scottsGateway public TV-pair + proxy) ──
router.use(publicRoutes);

// ── All routes below require superadmin ──
router.use(requireSuperAdmin);

// Private family-ops cockpit — only Scott + spouse (additional allowlist inside).
router.use('/scottsGateway', scottsGatewayRouter);

router.use(dashboard);
router.use(tenants);
router.use(ollama);
router.use(ops);
router.use(tickets);
router.use(users);
router.use(crossapp);
router.use(announcements);
router.use(gftv);
router.use(monitoring);

export default router;
