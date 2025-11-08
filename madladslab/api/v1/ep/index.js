import express from 'express';

const router = express.Router();
import blogs from './blogs.js'
import grafitti from './grafitti.js'
import brands from './brands.js'
import sites from './sites.js'
import qrs from './qrs.js'
import bucketUpload from './bucketUpload.js'
/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
router.use('/blogs',blogs)
router.use('/grafitti',grafitti)
router.use('/brands',brands)
router.use('/sites',sites)
router.use('/qrs',qrs)
router.use('/bucket',bucketUpload)
export default router;
