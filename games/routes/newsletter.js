// Public-facing newsletter routes:
//   GET  /newsletter                — threaded HTML page (static shell, JS loads issues)
//   GET  /newsletter/api/list       — published threads JSON
//   GET  /newsletter/api/:id        — single thread
//   POST /newsletter/api/subscribe  — { email } or auto-pulls from session user
//   GET  /newsletter/api/unsubscribe/:token — public single-click unsubscribe
const express = require('express');
const router = express.Router();
const newsletter = require('../lib/newsletter');

router.get('/', (req, res) => {
  res.sendFile('newsletter.html', { root: __dirname + '/../public' });
});

router.get('/api/list', async (req, res) => {
  try {
    const threads = await newsletter.listThreads({ limit: 40 });
    res.json({ ok: true, threads });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/:id', async (req, res) => {
  try {
    const t = await newsletter.getThread(req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, thread: t });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/api/subscribe', async (req, res) => {
  try {
    // Authed users get auto-subscribed with their session email; guests
    // submit one via the form. We never accept an email from the body when
    // the user is authed — prevents drive-by signing somebody else up.
    let email = null;
    let userId = null;
    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      email = req.user.email;
      userId = req.user._id;
    } else {
      email = (req.body && req.body.email) || '';
    }
    const source = (req.body && req.body.source) || 'landing';
    const result = await newsletter.subscribe({ email, source, userId });
    res.json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/api/unsubscribe/:token', async (req, res) => {
  try {
    const r = await newsletter.unsubscribe(req.params.token);
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
<style>body{background:#0a0a0a;color:#e8e8e8;font-family:'Courier New',monospace;padding:40px 20px;text-align:center}
.card{max-width:420px;margin:80px auto;background:#151515;border:1px solid #222;border-radius:8px;padding:28px}
h1{color:#cd412b;font-size:1.1rem;letter-spacing:0.12em;margin-bottom:12px}
p{color:#aaa;font-size:0.85rem;line-height:1.5}a{color:#cd412b}</style></head>
<body><div class="card">
<h1>${r.status === 'unsubscribed' ? 'Unsubscribed' : r.status === 'already_unsubscribed' ? 'Already removed' : 'Link expired'}</h1>
<p>${r.status === 'unsubscribed' ? 'You will no longer receive the MadLadsLab Games newsletter.' : r.status === 'already_unsubscribed' ? 'This email is already off the list.' : 'That unsubscribe link is no longer valid.'}</p>
<p style="margin-top:18px"><a href="/">Back to games.madladslab.com</a></p>
</div></body></html>`);
  } catch (e) { res.status(400).send(String(e.message)); }
});

module.exports = router;
