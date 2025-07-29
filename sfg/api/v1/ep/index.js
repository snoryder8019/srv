import express from 'express';

const router = express.Router();
import blogs from './blogs.js'
import brands from './brands.js'
/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
router.use('/blogs',blogs)
router.use('/brands',brands)
export default router;
