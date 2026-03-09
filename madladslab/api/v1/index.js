import express from 'express';
import ep from './ep/index.js'
import helpers from './models/helpers/crud.js'
import mcp from './mcp/index.js'
const router = express.Router();

/* GET home page. */
router.get('/', (req, res, next) => {
    res.json({"message":"sna version 1"})
});
function mcpAuth(req, res, next) {
  if (req.headers['x-mcp-secret'] !== process.env.MCP_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.use('/mcp', mcpAuth, mcp)
router.use('/',ep)
router.use('/helpers',helpers)
export default router;

