import express from 'express';
import {authRouter} from './passport/auth.js'
import { router as passportRouter } from './passport/localStrat.js';
const router = express.Router();
/* GET home page. */
router.get('/', (req, res, next) => {
next()
});
router.use('/', authRouter);
router.use(passportRouter);
export default router;
