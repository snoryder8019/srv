import express from 'express';
import ep from './ep/index.js'
import helpers from './models/helpers/crud.js'
import mcp from './mcp/index.js'
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
router.use('/mcp',mcp)
router.use('/',ep)
router.use('/helpers',helpers)
export default router;

