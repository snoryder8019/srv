import express from 'express';
import { ObjectId } from 'mongodb';
import { getDb } from '../plugins/mongo.js';
import { captureLead, confirmLead } from '../plugins/subscribe.js';

const router = express.Router();

/* ── Branded standalone page shell (matches the unsubscribe page styling) ── */
function brandedPage(req, { title, heading, bodyHtml, accentOk = true }) {
  const name = req.tenant?.brand?.name || 'Newsletter';
  const loc = req.tenant?.brand?.location || '';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} — ${name}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Jost',sans-serif;background:#F5F3EF;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#FDFCFA;max-width:460px;width:100%;border-radius:6px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.07)}.header{background:#1C2B4A;padding:24px 28px;text-align:center}.brand{font-family:'Cormorant Garamond',serif;font-size:20px;color:#FDFCFA}.bar{height:3px;background:#C9A848}.body{padding:32px;text-align:center}h1{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:300;margin-bottom:12px}p{font-size:14px;color:#6B7380;line-height:1.6;margin-bottom:20px}input[type=email],input[type=text]{width:100%;padding:10px 14px;border:1px solid #E6E1D6;border-radius:2px;font-family:'Jost',sans-serif;font-size:14px;margin-bottom:12px}.btn{display:inline-block;padding:12px 28px;background:#1C2B4A;color:#FDFCFA;border:none;font-family:'Jost',sans-serif;font-size:14px;font-weight:500;border-radius:3px;cursor:pointer;letter-spacing:.5px}.btn:hover{background:#2E4270}.footer{background:#F5F3EF;padding:16px;text-align:center;font-size:12px;color:#6B7380}.ok{color:#15803D;font-size:18px;margin-bottom:8px}.err{color:#8B1C1C;font-size:18px;margin-bottom:8px}</style></head>
<body><div class="card"><div class="header"><div class="brand">${name}</div></div><div class="bar"></div>
<div class="body"><h1>${heading}</h1>${bodyHtml}</div>
<div class="footer">${name}${loc ? ' &middot; ' + loc : ''}</div></div></body></html>`;
}

/** Look up a signup form by its public token, or return a synthetic default. */
async function resolveForm(db, token) {
  if (token && token !== 'default') {
    try {
      const form = await db.collection('signup_forms').findOne({ token, enabled: { $ne: false } });
      if (form) return form;
    } catch { /* fall through to default */ }
  }
  return {
    _id: null, token: 'default', name: 'Newsletter',
    headline: 'Join our newsletter', subhead: 'Get updates and offers straight to your inbox.',
    buttonText: 'Subscribe', collectName: false,
    funnel: 'lead', tags: ['newsletter'], source: 'signup-form',
    successMessage: 'Almost there — check your inbox to confirm.',
  };
}

// 1x1 transparent GIF (43 bytes)
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** Encode tracking data to a URL-safe token */
export function encodeTrackingToken(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Decode a tracking token back to an object */
export function decodeTrackingToken(str) {
  return JSON.parse(Buffer.from(str, 'base64url').toString());
}

/* ── 1:1 client mail (Emails tab) events ──
 * Counters live on the client_emails row itself so the tab renders open/click
 * state without a second query per message. `$min` seeds first*At on the first
 * hit (it sets the field when it's missing). */
function recordClientEmailEvent(db, emailId, type, { url = null, at = new Date() } = {}) {
  // Never let a mangled token throw — on the click path that would cost the
  // recipient their redirect.
  let _id;
  try { _id = new ObjectId(emailId); } catch { return; }
  if (!db) return;
  const update = type === 'click'
    ? {
        $inc: { clickCount: 1 },
        $set: { lastClickAt: at, lastClickUrl: url },
        $min: { firstClickAt: at },
        $push: { clicks: { $each: [{ url, at }], $slice: -25 } },
      }
    : {
        $inc: { openCount: 1 },
        $set: { lastOpenAt: at },
        $min: { firstOpenAt: at },
      };
  return db.collection('client_emails').updateOne({ _id }, update).catch(() => {});
}

// ── Open tracking pixel ──
router.get('/o/:token', async (req, res) => {
  // Respond immediately with pixel
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache', 'Pragma': 'no-cache' });
  res.end(PIXEL);

  // Record event in background
  try {
    const data = decodeTrackingToken(req.params.token);
    const db = req.db;
    if (data.e) return void recordClientEmailEvent(db, data.e, 'open');
    db.collection('campaign_events').insertOne({
      campaignId: new ObjectId(data.c),
      contactId: new ObjectId(data.r),
      type: 'open',
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
      createdAt: new Date(),
    }).catch(() => {});
  } catch {}
});

// ── Click redirect ──
router.get('/c/:token', async (req, res) => {
  try {
    const data = decodeTrackingToken(req.params.token);
    const url = data.u;

    // Record click in background
    const db = req.db;
    if (data.e) {
      recordClientEmailEvent(db, data.e, 'click', { url });
    } else {
      db.collection('campaign_events').insertOne({
        campaignId: new ObjectId(data.c),
        contactId: new ObjectId(data.r),
        type: 'click',
        url,
        ip: req.ip,
        userAgent: req.get('user-agent') || null,
        createdAt: new Date(),
      }).catch(() => {});
    }

    const fallback = req.tenant?.domain ? `https://${req.tenant.domain}` : '/';
    res.redirect(302, url || fallback);
  } catch {
    const fallback = req.tenant?.domain ? `https://${req.tenant.domain}` : '/';
    res.redirect(302, fallback);
  }
});

// ── Unsubscribe page ──
router.get('/unsubscribe', async (req, res) => {
  const email = req.query.email;
  const done = req.query.done === '1';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Unsubscribe — ${req.tenant?.brand?.name || 'Newsletter'}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Jost',sans-serif;background:#F5F3EF;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{background:#FDFCFA;max-width:460px;width:100%;border-radius:6px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,.07)}.header{background:#1C2B4A;padding:24px 28px;text-align:center}.brand{font-family:'Cormorant Garamond',serif;font-size:20px;color:#FDFCFA}.bar{height:3px;background:#C9A848}.body{padding:32px;text-align:center}h1{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:300;margin-bottom:12px}p{font-size:14px;color:#6B7380;line-height:1.6;margin-bottom:20px}input[type=email]{width:100%;padding:10px 14px;border:1px solid #E6E1D6;border-radius:2px;font-family:'Jost',sans-serif;font-size:14px;margin-bottom:12px}.btn{display:inline-block;padding:12px 28px;background:#1C2B4A;color:#FDFCFA;border:none;font-family:'Jost',sans-serif;font-size:14px;font-weight:500;border-radius:3px;cursor:pointer;letter-spacing:.5px}.btn:hover{background:#2E4270}.footer{background:#F5F3EF;padding:16px;text-align:center;font-size:12px;color:#6B7380}.ok{color:#15803D;font-size:18px;margin-bottom:8px}</style></head>
<body><div class="card"><div class="header"><div class="brand">${req.tenant?.brand?.name || 'Newsletter'}</div></div><div class="bar"></div>
<div class="body">
${done ? `<div class="ok">Unsubscribed</div><h1>You've been removed</h1><p>You will no longer receive marketing emails from ${req.tenant?.brand?.name || 'us'}. If this was a mistake, contact us anytime.</p>` :
`<h1>Unsubscribe</h1><p>We're sorry to see you go. Enter your email below to unsubscribe from our marketing emails.</p>
<form method="POST" action="/t/unsubscribe"><input type="email" name="email" value="${email || ''}" required placeholder="your@email.com"><br><button type="submit" class="btn">Unsubscribe</button></form>`}
</div><div class="footer">${req.tenant?.brand?.name || ''} &middot; ${req.tenant?.brand?.location || ''}</div></div></body></html>`);
});

// ── Unsubscribe POST handler ──
router.post('/unsubscribe', async (req, res) => {
  try {
    // Query fallback: RFC 8058 one-click unsubscribe (Gmail/Outlook "unsubscribe"
    // button) POSTs to the List-Unsubscribe URL with its own body, so the address
    // only survives in the query string.
    const email = (req.body.email || req.query.email || '').toLowerCase().trim();
    if (!email) return res.redirect('/t/unsubscribe');

    const db = req.db;
    const result = await db.collection('contacts').updateOne(
      { email },
      { $set: { status: 'unsubscribed', updatedAt: new Date() } }
    );

    // Also log as event if we can find the contact
    if (result.matchedCount) {
      const contact = await db.collection('contacts').findOne({ email });
      if (contact) {
        await db.collection('campaign_events').insertOne({
          contactId: contact._id,
          type: 'unsubscribe',
          email,
          ip: req.ip,
          createdAt: new Date(),
        }).catch(() => {});
      }
    }

    console.log(`[Email Marketing] Unsubscribe: ${email} (${result.matchedCount ? 'found' : 'not found'})`);
    res.redirect('/t/unsubscribe?done=1&email=' + encodeURIComponent(email));
  } catch (err) {
    console.error('Unsubscribe error:', err);
    res.redirect('/t/unsubscribe?done=1');
  }
});

// ── Subscribe (hosted form + embed widget post here) ──────────────────────
router.post('/subscribe', express.urlencoded({ extended: true }), async (req, res) => {
  const wantsJson = (req.get('accept') || '').includes('application/json')
    || req.xhr || req.get('x-requested-with') === 'XMLHttpRequest';
  try {
    // Honeypot
    if ((req.body._hp || req.body.website || '').trim()) {
      return wantsJson ? res.json({ ok: true, status: 'ignored', message: 'Thanks!' })
                       : res.redirect('/t/subscribed?status=ignored');
    }
    if (!req.db) {
      const m = 'This form is not available right now.';
      return wantsJson ? res.json({ ok: false, status: 'error', message: m }) : res.redirect('/t/subscribed?status=error');
    }
    const form = await resolveForm(req.db, req.body.token);
    const welcome = form.welcomeBody
      ? { subject: form.welcomeSubject, body: form.welcomeBody, successMessage: form.successMessage }
      : (form.successMessage ? { successMessage: form.successMessage } : null);

    const result = await captureLead({
      db: req.db, tenant: req.tenant,
      email: req.body.email, name: (req.body.name || '').trim(),
      funnel: form.funnel || 'lead',
      tags: form.tags?.length ? form.tags : ['newsletter'],
      source: form.source || `form:${form.token}`,
      formId: form._id, optIn: form.optIn || 'double', welcome,
    });
    const ok = result.status !== 'invalid';
    if (wantsJson) return res.json({ ok, status: result.status, message: result.message });
    return res.redirect(`/t/subscribed?status=${encodeURIComponent(result.status)}`);
  } catch (err) {
    console.error('[subscribe] error:', err);
    if (wantsJson) return res.status(500).json({ ok: false, message: 'Something went wrong. Please try again.' });
    return res.redirect('/t/subscribed?status=error');
  }
});

// ── Subscribe result page (no-JS fallback target) ──────────────────────────
router.get('/subscribed', (req, res) => {
  const s = req.query.status;
  const map = {
    pending:    ['Check your inbox', '<p>Almost there! We sent you a confirmation link — click it to finish subscribing.</p>', 'ok'],
    subscribed: ["You're subscribed", '<p>Thanks for joining. Keep an eye on your inbox.</p>', 'ok'],
    exists:     ["You're already in", '<p>This email is already on our list — thanks!</p>', 'ok'],
    ignored:    ['Thanks!', "<p>You're all set.</p>", 'ok'],
    invalid:    ['Check your email', '<p>That email address didn\'t look right. Please go back and try again.</p>', 'err'],
    error:      ['Something went wrong', '<p>Please try again in a moment.</p>', 'err'],
  };
  const [heading, body, cls] = map[s] || map.subscribed;
  res.send(brandedPage(req, { title: 'Subscribe', heading, bodyHtml: `<div class="${cls}">${cls === 'ok' ? '✓' : '!'}</div>${body}` }));
});

// ── Double opt-in confirmation ─────────────────────────────────────────────
router.get('/confirm/:token', async (req, res) => {
  try {
    const result = await confirmLead({ db: req.db, tenant: req.tenant, token: req.params.token });
    res.send(brandedPage(req, {
      title: 'Confirm', heading: result.ok ? "You're confirmed" : 'Hmm',
      bodyHtml: `<div class="${result.ok ? 'ok' : 'err'}">${result.ok ? '✓' : '!'}</div><p>${result.message}</p>`,
    }));
  } catch (err) {
    console.error('[confirm] error:', err);
    res.send(brandedPage(req, { title: 'Confirm', heading: 'Hmm', bodyHtml: `<div class="err">!</div><p>We couldn't confirm that link.</p>` }));
  }
});

// ── Hosted standalone form page (shareable link) ───────────────────────────
router.get('/f/:token', async (req, res) => {
  const form = await resolveForm(req.db, req.params.token);
  const nameField = form.collectName
    ? `<input type="text" name="name" placeholder="Your name" autocomplete="name">`
    : '';
  const body = `
    ${form.subhead ? `<p>${form.subhead}</p>` : ''}
    <form id="sf" onsubmit="return sfSubmit(event)">
      <input type="hidden" name="token" value="${form.token}">
      <input type="text" name="website" style="position:absolute;left:-9999px;" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${nameField}
      <input type="email" name="email" placeholder="you@example.com" required autocomplete="email">
      <button type="submit" class="btn">${form.buttonText || 'Subscribe'}</button>
    </form>
    <div id="sfMsg" style="margin-top:14px;"></div>
    <script>
    function sfSubmit(e){e.preventDefault();var f=e.target,b=f.querySelector('button');b.disabled=true;
      fetch('/t/subscribe',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:new URLSearchParams(new FormData(f))})
      .then(function(r){return r.json()}).then(function(d){document.getElementById('sfMsg').innerHTML='<div class="'+(d.ok?'ok':'err')+'">'+(d.message||'')+'</div>';if(d.ok&&d.status!=='exists')f.style.display='none';})
      .catch(function(){document.getElementById('sfMsg').innerHTML='<div class="err">Something went wrong. Please try again.</div>';b.disabled=false;});
      return false;}
    </script>`;
  res.send(brandedPage(req, { title: form.name || 'Subscribe', heading: form.headline || 'Subscribe', bodyHtml: body }));
});

// ── Embeddable widget script (drop on any external site) ───────────────────
router.get('/f/:token/embed.js', async (req, res) => {
  const form = await resolveForm(req.db, req.params.token);
  const origin = req.tenant?.domain ? `https://${req.tenant.domain}` : '';
  const accent = '#C9A848';
  const cfg = {
    token: form.token, headline: form.headline || 'Join our newsletter',
    subhead: form.subhead || '', button: form.buttonText || 'Subscribe',
    collectName: !!form.collectName, origin,
  };
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.send(`(function(){
  var C=${JSON.stringify(cfg)};var A=${JSON.stringify(accent)};
  var s=document.currentScript;var host=document.createElement('div');
  host.style.cssText='max-width:420px;font-family:system-ui,sans-serif;';
  var nameF=C.collectName?'<input name="name" placeholder="Your name" style="width:100%;padding:10px 12px;margin-bottom:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;">':'';
  host.innerHTML='<div style="border:1px solid #e6e1d6;border-radius:8px;padding:18px;background:#fff;">'
    +'<div style="font-size:18px;font-weight:600;margin-bottom:4px;">'+C.headline+'</div>'
    +(C.subhead?'<div style="font-size:13px;color:#667;margin-bottom:12px;">'+C.subhead+'</div>':'')
    +'<form><input type="text" name="website" style="position:absolute;left:-9999px;" tabindex="-1" aria-hidden="true">'
    +nameF
    +'<input type="email" name="email" placeholder="you@example.com" required style="width:100%;padding:10px 12px;margin-bottom:8px;border:1px solid #ddd;border-radius:6px;box-sizing:border-box;">'
    +'<button type="submit" style="width:100%;padding:11px;border:0;border-radius:6px;background:'+A+';color:#0F1B30;font-weight:600;cursor:pointer;">'+C.button+'</button>'
    +'<div class="msg" style="margin-top:10px;font-size:13px;"></div></form></div>';
  s.parentNode.insertBefore(host,s);
  var form=host.querySelector('form');var msg=host.querySelector('.msg');
  form.addEventListener('submit',function(e){e.preventDefault();var b=form.querySelector('button');b.disabled=true;
    var data=new URLSearchParams(new FormData(form));data.append('token',C.token);
    fetch(C.origin+'/t/subscribe',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:data})
    .then(function(r){return r.json()}).then(function(d){msg.style.color=d.ok?'#15803D':'#8B1C1C';msg.textContent=d.message||'';if(d.ok&&d.status!=='exists')form.style.display='none';})
    .catch(function(){msg.style.color='#8B1C1C';msg.textContent='Something went wrong.';b.disabled=false;});});
})();`);
});

// ── Bounce webhook (generic — works with Zoho or any ESP that can POST) ──
router.post('/webhook/bounce', async (req, res) => {
  try {
    const db = req.db;
    const email = (req.body.email || req.body.recipient || '').toLowerCase().trim();
    const bounceType = req.body.type || req.body.bounce_type || 'hard';

    if (email) {
      await db.collection('contacts').updateOne(
        { email },
        { $set: { status: 'bounced', bounceType, bouncedAt: new Date(), updatedAt: new Date() } }
      );

      const contact = await db.collection('contacts').findOne({ email });
      if (contact) {
        await db.collection('campaign_events').insertOne({
          contactId: contact._id,
          type: 'bounce',
          email,
          bounceType,
          raw: req.body,
          createdAt: new Date(),
        }).catch(() => {});
      }

      console.log(`[Email Marketing] Bounce: ${email} (${bounceType})`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Bounce webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// ── Complaint/spam webhook ──
router.post('/webhook/complaint', async (req, res) => {
  try {
    const db = req.db;
    const email = (req.body.email || req.body.recipient || '').toLowerCase().trim();

    if (email) {
      await db.collection('contacts').updateOne(
        { email },
        { $set: { status: 'unsubscribed', unsubReason: 'complaint', updatedAt: new Date() } }
      );

      const contact = await db.collection('contacts').findOne({ email });
      if (contact) {
        await db.collection('campaign_events').insertOne({
          contactId: contact._id,
          type: 'complaint',
          email,
          raw: req.body,
          createdAt: new Date(),
        }).catch(() => {});
      }

      console.log(`[Email Marketing] Spam complaint: ${email}`);
    }

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('Complaint webhook error:', err);
    res.status(200).json({ received: true });
  }
});

// ── Inbound email webhook (captures client replies) ──
// Zoho / any ESP can POST here when a reply comes in
router.post('/webhook/inbound', async (req, res) => {
  try {
    const db = req.db;
    const from = (req.body.from || req.body.sender || req.body.from_email || '').toLowerCase().trim();
    const to = req.body.to || req.body.recipient || '';
    const subject = req.body.subject || '(no subject)';
    const body = req.body.body || req.body.text || req.body.html || req.body['body-html'] || req.body['body-plain'] || '';

    if (!from) return res.status(200).json({ received: true, note: 'no from address' });

    // Match to a client by email
    const client = await db.collection('clients').findOne({ email: from });
    const clientId = client ? client._id.toString() : null;

    await db.collection('client_emails').insertOne({
      clientId,
      direction: 'inbound',
      from,
      to,
      cc: req.body.cc ? (typeof req.body.cc === 'string' ? req.body.cc.split(',').map(e => e.trim()) : req.body.cc) : [],
      subject,
      body,
      receivedAt: new Date(),
      sentAt: new Date(),
      raw: req.body,
    });

    console.log(`[Email] Inbound from ${from}${client ? ' (client: ' + client.name + ')' : ' (unmatched)'}`);
    res.status(200).json({ received: true, matched: !!client });
  } catch (err) {
    console.error('Inbound email webhook error:', err);
    res.status(200).json({ received: true });
  }
});

export default router;
