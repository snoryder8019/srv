 import express from 'express';
const router = express.Router();
import plugins from '../plugins/index.js'
import admin from "./admin/index.js"
import q from "./q/index.js"
import grafitti from "./grafitti/index.js"
import payments from "./payments/index.js"
import contact from "./contact.js"
import livechat from "./livechat.js"
import hue from "./hue/index.js"
import agents from "./agents/index.js"
import skins from "./skins/index.js"
import w2marketing from "./w2marketing/index.js"
import Agent from "../api/v1/models/Agent.js"
import ForwardChatSite from "../api/v1/models/ForwardChatSite.js"
/* GET home page. */

router.use('/admin', admin)
router.use('/agents', agents)
router.use('/skins', skins)
router.use('/q', q) // Short URL redirects for QR codes
router.use('/grafitti', grafitti)
router.use('/payments', payments)
router.use('/contact', contact)
router.use('/livechat', livechat)
router.use('/hue', hue)
router.use('/w2marketing', w2marketing)
router.use('/', plugins)
router.get('/', async function(req, res, next) {
  try {
    const user = req.user;
    const site = await ForwardChatSite.findOne({ siteUrl: /madladslab\.com/i, enabled: true })
      .populate('activeAgent', 'name description')
      .lean();
    const chatAgent = site?.activeAgent ? { ...site.activeAgent, _siteToken: site.plugin.token } : null;
    res.render('index', { title: 'Express', user, chatAgent });
  } catch (e) {
    res.render('index', { title: 'Express', user: req.user, chatAgent: null });
  }
});
router.get('/auth', function(req, res, next) {
  res.render('auth/index', { title: 'Auth' });
});
export default router
