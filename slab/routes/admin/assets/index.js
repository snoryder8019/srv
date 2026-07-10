// /admin/assets — composed router. Split from a 1,930-line single file into a
// shared helper module + focused feature routers (extract-and-shim). Routes are
// mutually non-overlapping, so mount order does not affect match precedence.
import express from 'express';
import library from './library.js';
import packs from './packs.js';
import generate from './generate.js';
import brandkit from './brandkit.js';
import folders from './folders.js';
import campaigns from './campaigns.js';
import resources from './resources.js';
import presets from './presets.js';
import optimize from './optimize.js';
import describe from './describe.js';
import drive from './drive.js';
import photos from './photos.js';

const router = express.Router();
router.use(library);
router.use(packs);
router.use(generate);
router.use(brandkit);
router.use(folders);
router.use(campaigns);
router.use(resources);
router.use(presets);
router.use(optimize);
router.use(describe);
router.use(drive);
router.use(photos);

export default router;
