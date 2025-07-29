import express from 'express';
import ep from './ep/index.js'
import helpers from './models/helpers/crud.js'
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
router.use('/',ep)
router.use('/helpers',helpers)
export default router;

