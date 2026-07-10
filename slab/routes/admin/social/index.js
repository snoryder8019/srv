// /admin/social — composed router. Split from a 1,739-line single file into
// focused modules (extract-and-shim). Sub-routers mount in the original order so
// route-match precedence is byte-for-byte identical to the pre-split file.
import express from 'express';
import dashboard from './dashboard.js';
import live from './live.js';
import engage from './engage.js';
import connections from './connections.js';
import compose from './compose.js';
import suggestions from './suggestions.js';
import voice from './voice.js';
import studio from './studio.js';
import oauth from './oauth.js';

const router = express.Router();
router.use(dashboard);
router.use(live);
router.use(engage);
router.use(connections);
router.use(compose);
router.use(suggestions);
router.use(voice);
router.use(studio);
router.use(oauth);

export default router;
