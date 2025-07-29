import express from 'express';
import v1 from './v1/index.js'
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
 res.json(
    {"message":"sna ap1"}
 )
});
router.use('/v1',v1)

export default router;
