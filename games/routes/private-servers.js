'use strict';

/**
 * routes/private-servers.js
 *
 * All games available as private servers — $15/mo each.
 * Game selected at checkout, provisioned on g6-standard-2 Linode.
 *
 * GET  /private-servers              — game picker + user dashboard
 * GET  /private-servers/checkout?game=rust — Stripe Checkout
 * GET  /private-servers/success
 * GET  /private-servers/cancel
 * POST /private-servers/webhook      — Stripe (raw body)
 * GET  /api/private/servers
 * GET  /api/private/servers/:id
 * POST /api/private/servers/:id/cancel
 * GET  /api/private/admin/all
 * GET  /api/private/slots
 */

const express     = require('express');
const router      = express.Router();
const provisioner = require('../lib/private-server-provisioner');

const STRIPE_SECRET         = () => process.env.STRIPE_PRIVATE_SECRET;
const STRIPE_WEBHOOK_SECRET = () => process.env.STRIPE_PRIVATE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID       = () => process.env.STRIPE_PRIVATE_PRICE_ID;
const BASE_URL              = 'https://games.madladslab.com';

// ── Game catalog ───────────────────────────────────────────────────────────
const GAMES = {
  rust: {
    id: 'rust', name: 'Rust', emoji: '🔧',
    color: '#cd412b', bg: '#1a0800',
    tagline: 'Survival PvP — your rules',
    desc: 'Full Rust dedicated server with Carbon mod framework. Customize wipe cycles, player limits, and plugins.',
    specs: '4GB RAM · up to 50 players · Carbon mods',
    mods: 'Carbon framework — .cs plugins included: Kits, Clans, Friends, No Decay (customizable)',
    features: ['Carbon mod framework', 'Custom wipe schedule', 'Up to 50 players', 'RCON access', 'World backups'],
    port: 28015,
  },
  valheim: {
    id: 'valheim', name: 'Valheim', emoji: '⚔️',
    color: '#4a7c9e', bg: '#08141a',
    tagline: 'Viking survival co-op',
    desc: 'Persistent Viking world with BepInEx mod support. Your world saves every 20 minutes.',
    specs: '4GB RAM · up to 10 players · BepInEx mods',
    mods: 'BepInEx pre-installed — popular mods: Valheim Plus, Plant Everything, Epic Loot',
    features: ['BepInEx mod support', 'Persistent world', 'Up to 10 players', 'World backups', 'Custom seed'],
    port: 2456,
  },
  l4d2: {
    id: 'l4d2', name: 'Left 4 Dead 2', emoji: '🧟',
    color: '#2e7d32', bg: '#081008',
    tagline: 'Co-op zombie survival',
    desc: 'Private L4D2 server with SourceMod. Run custom campaigns, mutations, and competitive configs.',
    specs: '4GB RAM · up to 8 players · SourceMod',
    mods: 'SourceMod + MetaMod — includes: Admin Menu, Votes, Ready-Up, Competitive config',
    features: ['SourceMod plugins', 'Custom campaigns', 'Up to 8 players', 'Mutation support', 'Admin controls'],
    port: 27015,
  },
  '7dtd': {
    id: '7dtd', name: '7 Days to Die', emoji: '🏚️',
    color: '#c46200', bg: '#150900',
    tagline: 'Survival horror & crafting',
    desc: 'Full 7DTD server with mod folder support. Horde nights, custom gamestage, and XML mod packs.',
    specs: '4GB RAM · up to 8 players · Folder mods',
    mods: 'Mod folder pre-configured — includes: Darkness Falls lite, SMX UI, extra vehicles',
    features: ['XML mod packs', 'Custom horde settings', 'Up to 8 players', 'World backups', 'Admin console'],
    port: 26900,
  },
  se: {
    id: 'se', name: 'Space Engineers', emoji: '🚀',
    color: '#4a8cd6', bg: '#08101a',
    tagline: 'Engineering & survival in space',
    desc: 'Space Engineers dedicated server with script and workshop mod support. Build, engineer, survive.',
    specs: '4GB RAM · up to 6 players · Workshop mods',
    mods: 'Workshop mod IDs pre-loaded — NPC Encounters, Wasteland, Corruption PvE pack',
    features: ['Workshop mods', 'Custom world settings', 'Up to 6 players', 'World backups', 'Economy enabled'],
    port: 27016,
  },
  palworld: {
    id: 'palworld', name: 'Palworld', emoji: '🐾',
    color: '#3db87a', bg: '#08150f',
    tagline: 'Survival with creature companions',
    desc: 'Palworld dedicated server — persistent island, custom Pal spawn rates, PvP/PvE toggle.',
    specs: '4GB RAM · up to 16 players · Server config',
    mods: 'Full server config — Pal spawn multipliers, drop rates, XP boost, day speed',
    features: ['Custom spawn rates', 'PvP or PvE', 'Up to 16 players', 'World backups', 'Persistent island'],
    port: 8211,
  },
  minecraft: {
    id: 'minecraft', name: 'Minecraft Java', emoji: '⛏️',
    color: '#4caf50', bg: '#0a150a',
    tagline: 'The original sandbox',
    desc: 'PaperMC 1.21.4 with Aikar JVM flags. Fast, optimized, with Paper plugin support.',
    specs: '4GB RAM · up to 20 players · Paper plugins',
    mods: 'PaperMC — includes: EssentialsX, LuckPerms, WorldEdit, dynmap',
    features: ['PaperMC plugins', 'Persistent world', 'Up to 20 players', 'World backups', 'Whitelist control'],
    port: 25565,
  },
};

// ── Auth guards ────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Login required' });
  const u = req.user;
  if (u.isAdmin || u.permissions?.games === 'admin') return next();
  res.status(403).json({ error: 'Admin only' });
}

function stripe() {
  if (!STRIPE_SECRET()) throw new Error('STRIPE_PRIVATE_SECRET not configured');
  return require('stripe')(STRIPE_SECRET());
}

// ─────────────────────────────────────────────────────────────────────────
// PAGES
// ─────────────────────────────────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  const servers = await provisioner.getUserServers(req.user._id.toString()).catch(() => []);
  const enriched = await Promise.all(servers.map(async s => {
    const ready = s.status === 'active';
    const ageMin = (Date.now() - new Date(s.createdAt).getTime()) / 60000;
    return { ...s, ready, ageMin: Math.round(ageMin) };
  }));
  res.send(buildPageHTML(req.user, enriched));
});

router.get('/checkout', requireAuth, async (req, res) => {
  const gameId = req.query.game;
  const game   = GAMES[gameId];
  if (!game) return res.redirect('/private-servers');

  if (!STRIPE_SECRET() || !STRIPE_PRICE_ID()) {
    return res.send(buildErrorHTML('Payment not configured yet. Check back soon.'));
  }

  try {
    const u = req.user;
    const s = stripe();

    let customerId = u.stripeCustomerId || null;
    if (!customerId) {
      const customer = await s.customers.create({
        email: u.email,
        name: u.displayName || u.email,
        metadata: { userId: u._id.toString() },
      });
      customerId = customer.id;
      await req.app.locals.db.collection('users').updateOne(
        { _id: u._id },
        { $set: { stripeCustomerId: customerId } }
      );
    }

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICE_ID(), quantity: 1 }],
      subscription_data: {
        metadata: {
          userId:    u._id.toString(),
          userName:  u.displayName || u.email,
          userEmail: u.email,
          game:      gameId,
        },
      },
      success_url: BASE_URL + '/private-servers/success?game=' + gameId + '&session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  BASE_URL + '/private-servers',
      metadata:    { userId: u._id.toString(), userEmail: u.email, game: gameId },
    });

    res.redirect(303, session.url);
  } catch (e) {
    console.error('[private] Checkout error:', e.message);
    res.send(buildErrorHTML('Could not start checkout: ' + e.message));
  }
});

router.get('/success', requireAuth, (req, res) => {
  const game = GAMES[req.query.game] || GAMES.minecraft;
  res.send(buildSuccessHTML(req.user, game));
});

router.get('/cancel', requireAuth, (req, res) => res.redirect('/private-servers'));

// ─────────────────────────────────────────────────────────────────────────
// STRIPE WEBHOOK
// ─────────────────────────────────────────────────────────────────────────
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET());
  } catch (e) {
    console.error('[private-webhook] Sig error:', e.message);
    return res.status(400).send('Webhook Error: ' + e.message);
  }
  try { await handleStripeEvent(event, req.app.locals.db); }
  catch (e) { console.error('[private-webhook] Handler error:', e.message); return res.status(500).send('Error'); }
  res.json({ received: true });
});

async function handleStripeEvent(event, db) {
  const s = stripe();
  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') break;
      const sub  = await s.subscriptions.retrieve(session.subscription);
      const meta = sub.metadata || session.metadata || {};
      const { userId, userName, userEmail, game } = meta;
      if (!userId || !userEmail) { console.error('[private-webhook] Missing metadata', session.id); break; }
      const existing = await db.collection('private_servers').findOne({ stripeSubId: sub.id });
      if (existing) break;
      console.log('[private-webhook] New sub', sub.id, game, '→', userEmail);
      await provisioner.createPrivateServer({ userId, userName, userEmail, game: game || 'minecraft', stripeSubId: sub.id, stripeCustomerId: session.customer });
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      if (invoice.subscription) await provisioner.activateSlot(invoice.subscription);
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log('[private-webhook] Sub cancelled:', sub.id);
      await provisioner.cancelPrivateServer(sub.id);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        await db.collection('private_servers').updateOne(
          { stripeSubId: invoice.subscription },
          { $set: { status: 'payment_failed', paymentFailedAt: new Date() } }
        );
      }
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────

router.get('/api/private/servers', requireAuth, async (req, res) => {
  try { res.json({ servers: await provisioner.getUserServers(req.user._id.toString()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/private/servers/:id', requireAuth, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const db = req.app.locals.db;
    const server = await db.collection('private_servers')
      .findOne({ _id: new ObjectId(req.params.id), userId: req.user._id.toString() });
    if (!server) return res.status(404).json({ error: 'Not found' });

    let linodeReady = server.status === 'active';
    if (!linodeReady) {
      const ld = await provisioner.getLinodeStatus(server.linodeId);
      if (ld?.status === 'running') {
        const ageMin = (Date.now() - new Date(server.createdAt).getTime()) / 60000;
        linodeReady = ageMin > 12;
        if (linodeReady) {
          await db.collection('private_servers').updateOne({ _id: server._id }, { $set: { status: 'active', activatedAt: new Date() } });
          server.status = 'active';
        }
      }
    }

    const game = GAMES[server.game] || GAMES.minecraft;
    res.json({ server, linodeReady, connect: linodeReady ? `${server.ip}:${server.port}` : null, game });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/private/servers/:id/cancel', requireAuth, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const db = req.app.locals.db;
    const server = await db.collection('private_servers')
      .findOne({ _id: new ObjectId(req.params.id), userId: req.user._id.toString() });
    if (!server) return res.status(404).json({ error: 'Not found' });
    if (!server.stripeSubId) return res.status(400).json({ error: 'No subscription linked' });
    await stripe().subscriptions.update(server.stripeSubId, { cancel_at_period_end: true });
    await db.collection('private_servers').updateOne({ _id: server._id }, { $set: { cancelAtPeriodEnd: true, cancelledAt: new Date() } });
    res.json({ ok: true, message: 'Server cancelled at end of billing period' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/private/slots', async (req, res) => {
  try { res.json(await provisioner.slotStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/api/private/admin/all', requireAdmin, async (req, res) => {
  try { res.json(await provisioner.listAll()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/api/private/admin/servers/:id/destroy', requireAdmin, async (req, res) => {
  try {
    const { ObjectId } = require('mongodb');
    const db = req.app.locals.db;
    const server = await db.collection('private_servers').findOne({ _id: new ObjectId(req.params.id) });
    if (!server) return res.status(404).json({ error: 'Not found' });
    if (server.stripeSubId) { try { await stripe().subscriptions.cancel(server.stripeSubId); } catch {} }
    await provisioner.cancelPrivateServer(server.stripeSubId || server._id.toString());
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────
// HTML BUILDER
// ─────────────────────────────────────────────────────────────────────────

function buildPageHTML(user, servers) {
  const name = user.displayName || user.email.split('@')[0];
  const stripeReady = !!(process.env.STRIPE_PRIVATE_SECRET && process.env.STRIPE_PRIVATE_PRICE_ID);
  const hasServers = servers.length > 0;

  const gameCards = Object.values(GAMES).map(g => {
    const btn = stripeReady
      ? `<a href="/private-servers/checkout?game=${g.id}" class="btn-get" style="background:${g.color}">Get ${g.name} →</a>`
      : `<span class="btn-get btn-soon">Coming Soon</span>`;

    return `
    <div class="game-card" data-game="${g.id}">
      <div class="game-card-header" style="border-left:3px solid ${g.color};background:linear-gradient(135deg,${g.bg} 0%,#141414 100%)">
        <span class="game-emoji">${g.emoji}</span>
        <div>
          <div class="game-name">${g.name}</div>
          <div class="game-tagline">${g.tagline}</div>
        </div>
        <div class="game-price">$15<span>/mo</span></div>
      </div>
      <div class="game-card-body">
        <p class="game-desc">${g.desc}</p>
        <div class="game-specs">${g.specs}</div>
        <div class="game-mods-label">Included mods &amp; plugins</div>
        <div class="game-mods">${g.mods}</div>
        <ul class="game-features">
          ${g.features.map(f => `<li>${f}</li>`).join('')}
        </ul>
        <div class="game-card-footer">
          ${btn}
        </div>
      </div>
    </div>`;
  }).join('');

  const serverCards = servers.map(s => {
    const g = GAMES[s.game] || GAMES.minecraft;
    const statusColor = s.ready ? '#22c55e' : '#f97316';
    const statusText  = s.ready ? 'Online' : (s.ageMin > 12 ? 'Almost ready' : 'Setting up…');
    const connectInfo = s.ready
      ? `<div class="connect-box">
           <span class="connect-label">Connect:</span>
           <code class="connect-addr">${s.ip}:${s.port || g.port}</code>
           <button class="copy-btn" onclick="navigator.clipboard.writeText('${s.ip}:${s.port || g.port}');this.textContent='Copied!'">Copy</button>
         </div>`
      : `<div class="provisioning-note">⏳ Setting up your server — usually ready in 10–15 min. Page refreshes automatically.</div>`;

    return `
    <div class="server-card" style="border-color:${g.color}20">
      <div class="card-header">
        <span class="game-emoji-sm">${g.emoji}</span>
        <div>
          <div class="server-name">${s.serverName || g.name}</div>
          <div class="server-meta">${g.name} · Slot ${s.slotIndex}</div>
        </div>
        <div class="status-pill" style="background:${statusColor}20;color:${statusColor};border-color:${statusColor}40">
          <span class="status-dot" style="background:${statusColor}"></span>${statusText}
        </div>
      </div>
      ${connectInfo}
      <div class="card-actions">
        ${s.cancelAtPeriodEnd
          ? `<span style="font-size:12px;color:#f97316">Cancels at billing period end</span>`
          : `<button class="btn-cancel" onclick="cancelServer('${s._id}')">Cancel Subscription</button>`}
      </div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Private Servers — MadLadsLab</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Space+Mono&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',sans-serif;background:#0a0a0a;color:#e5e5e5;min-height:100vh}

    /* Topbar */
    .topbar{background:#141414;border-bottom:1px solid #222;padding:0 24px;height:52px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
    .logo{font-size:18px;font-weight:700;color:#fff;text-decoration:none}
    .logo span{color:#22c55e}
    .topbar-right{display:flex;align-items:center;gap:12px;font-size:13px}
    .topbar-right a{color:#737373;text-decoration:none;padding:5px 10px;border-radius:4px;transition:color .15s}
    .topbar-right a:hover{color:#e5e5e5}
    .user-badge{color:#525252;font-size:12px}

    /* Layout */
    .container{max-width:1100px;margin:0 auto;padding:32px 24px}
    .page-header{margin-bottom:40px}
    .page-title{font-size:28px;font-weight:700;margin-bottom:6px}
    .page-sub{color:#737373;font-size:14px;line-height:1.6}

    /* Filter tabs */
    .filter-bar{display:flex;gap:8px;margin-bottom:28px;flex-wrap:wrap}
    .filter-tab{padding:6px 16px;border-radius:20px;border:1px solid #262626;background:transparent;color:#737373;cursor:pointer;font-size:12px;font-family:'Inter',sans-serif;transition:all .15s}
    .filter-tab:hover,.filter-tab.active{border-color:#22c55e;color:#22c55e;background:#22c55e12}

    /* Game cards grid */
    .games-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;margin-bottom:48px}
    .game-card{background:#141414;border:1px solid #262626;border-radius:10px;overflow:hidden;transition:border-color .2s,transform .2s}
    .game-card:hover{border-color:#333;transform:translateY(-2px)}
    .game-card-header{padding:18px 20px;display:flex;align-items:center;gap:14px}
    .game-emoji{font-size:28px;width:44px;text-align:center}
    .game-name{font-size:16px;font-weight:600;margin-bottom:2px}
    .game-tagline{font-size:12px;color:#737373}
    .game-price{margin-left:auto;font-size:22px;font-weight:700;font-family:'Space Mono',monospace;color:#e5e5e5;white-space:nowrap}
    .game-price span{font-size:12px;color:#525252;font-weight:400}
    .game-card-body{padding:0 20px 20px}
    .game-desc{font-size:13px;color:#a3a3a3;line-height:1.6;margin-bottom:12px}
    .game-specs{font-size:11px;color:#525252;background:#111;border:1px solid #1f1f1f;padding:6px 10px;border-radius:5px;margin-bottom:12px;font-family:'Space Mono',monospace}
    .game-mods-label{font-size:10px;text-transform:uppercase;letter-spacing:.8px;color:#525252;margin-bottom:6px}
    .game-mods{font-size:12px;color:#737373;margin-bottom:14px;line-height:1.5}
    .game-features{list-style:none;margin-bottom:18px;display:flex;flex-wrap:wrap;gap:6px}
    .game-features li{font-size:11px;color:#22c55e;background:#22c55e12;border:1px solid #22c55e25;padding:3px 10px;border-radius:12px}
    .game-card-footer{border-top:1px solid #1f1f1f;padding-top:16px}
    .btn-get{display:block;text-align:center;padding:11px;border-radius:7px;font-weight:700;font-size:14px;text-decoration:none;color:#fff;transition:opacity .15s,transform .15s;letter-spacing:.03em}
    .btn-get:hover{opacity:.88;transform:translateY(-1px)}
    .btn-soon{background:#1f1f1f;color:#525252;cursor:not-allowed}

    /* Active servers section */
    .section-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#525252;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .section-label::after{content:'';flex:1;height:1px;background:#1f1f1f}
    .server-card{background:#141414;border:1px solid #1f1f1f;border-radius:10px;padding:20px;margin-bottom:14px}
    .card-header{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .game-emoji-sm{font-size:22px;width:36px;text-align:center}
    .server-name{font-size:15px;font-weight:600}
    .server-meta{font-size:11px;color:#525252;margin-top:2px}
    .status-pill{margin-left:auto;display:flex;align-items:center;gap:5px;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:600;border:1px solid}
    .status-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    .connect-box{background:#0d0d0d;border:1px solid #1a1a1a;border-radius:6px;padding:10px 14px;display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap}
    .connect-label{font-size:11px;color:#525252}
    .connect-addr{font-family:'Space Mono',monospace;font-size:13px;color:#22c55e;background:#0d150d;padding:3px 8px;border-radius:4px}
    .copy-btn{background:transparent;border:1px solid #262626;color:#737373;padding:3px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-family:'Inter',sans-serif;transition:all .15s}
    .copy-btn:hover{border-color:#22c55e;color:#22c55e}
    .provisioning-note{color:#f97316;font-size:12px;margin-bottom:12px;padding:9px 12px;background:#150900;border:1px solid #f9731625;border-radius:5px}
    .card-actions{display:flex;gap:8px}
    .btn-cancel{background:transparent;border:1px solid #3f1515;color:#ef4444;padding:5px 14px;border-radius:5px;cursor:pointer;font-size:12px;font-family:'Inter',sans-serif;transition:all .15s}
    .btn-cancel:hover{background:#3f1515}

    /* Empty state */
    .empty-state{text-align:center;padding:48px 24px;color:#525252;border:1px dashed #1f1f1f;border-radius:10px;margin-bottom:40px}
    .empty-state h3{color:#737373;margin-bottom:6px;font-size:16px}
    .empty-state p{font-size:13px}

    /* FAQ */
    .faq{max-width:680px;margin-top:48px}
    .faq-title{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#525252;margin-bottom:20px}
    .faq details{border-bottom:1px solid #1a1a1a;padding:14px 0}
    .faq summary{font-size:14px;font-weight:500;cursor:pointer;color:#a3a3a3;list-style:none;display:flex;justify-content:space-between;align-items:center}
    .faq summary::-webkit-details-marker{display:none}
    .faq summary::after{content:'+';color:#525252;font-size:18px;transition:transform .2s}
    .faq details[open] summary::after{transform:rotate(45deg)}
    .faq details[open] summary{color:#e5e5e5}
    .faq-answer{font-size:13px;color:#737373;line-height:1.7;margin-top:10px}

    @media(max-width:640px){.games-grid{grid-template-columns:1fr}.page-title{font-size:22px}}
  </style>
</head>
<body>

<div class="topbar">
  <a href="/" class="logo">Mad<span>Lads</span>Lab</a>
  <div class="topbar-right">
    <a href="/dashboard">← Dashboard</a>
    <span class="user-badge">${name}</span>
    <form method="POST" action="/logout" style="margin:0">
      <button style="background:none;border:none;color:#525252;cursor:pointer;font-size:13px;font-family:inherit">Logout</button>
    </form>
  </div>
</div>

<div class="container">

  <div class="page-header">
    <div class="page-title">🎮 Private Game Servers</div>
    <div class="page-sub">Your own dedicated server — persistent world, pre-loaded mods, full control. $15/mo per server. Cancel anytime.</div>
  </div>

  <!-- Your active servers -->
  ${hasServers ? `
  <div class="section-label">Your Active Servers</div>
  ${serverCards}
  ` : `
  <div class="empty-state">
    <h3>No active servers</h3>
    <p>Pick a game below and get your private server in minutes.</p>
  </div>
  `}

  <!-- Filter -->
  <div class="filter-bar">
    <button class="filter-tab active" onclick="filterGames('all',this)">All Games</button>
    <button class="filter-tab" onclick="filterGames('survival',this)">Survival</button>
    <button class="filter-tab" onclick="filterGames('shooter',this)">Shooter</button>
    <button class="filter-tab" onclick="filterGames('sandbox',this)">Sandbox</button>
  </div>

  <!-- Game catalog -->
  <div class="games-grid" id="gamesGrid">
    ${gameCards}
  </div>

  <!-- FAQ -->
  <div class="faq">
    <div class="faq-title">Frequently Asked Questions</div>

    <details>
      <summary>How long does setup take?</summary>
      <p class="faq-answer">After payment a Linode boots and installs your game server automatically. Most games are ready in 10–15 minutes. Your connect address appears on this page once it's live.</p>
    </details>

    <details>
      <summary>What's a Linode slot?</summary>
      <p class="faq-answer">You share a 4GB cloud server with up to 3 other subscribers. Each slot gets its own isolated process, ports, and world files. You never interact with other slots.</p>
    </details>

    <details>
      <summary>What happens when I cancel?</summary>
      <p class="faq-answer">Your server stays up until the end of your billing period. Your world is backed up to object storage before the slot is released, and can be restored if you resubscribe.</p>
    </details>

    <details>
      <summary>Can I request additional mods or plugins?</summary>
      <p class="faq-answer">Yes — reach out to an admin via the suggest page. We can drop in specific Paper plugins, Carbon scripts, BepInEx mods, or SourceMod plugins on request.</p>
    </details>

    <details>
      <summary>Can I have multiple servers?</summary>
      <p class="faq-answer">Yes — each subscription is a separate slot. You can run Rust and Minecraft simultaneously, for example.</p>
    </details>
  </div>

</div>

<script>
const FILTER_MAP = {
  survival: ['rust','valheim','7dtd','palworld'],
  shooter:  ['l4d2','rust'],
  sandbox:  ['minecraft','se','valheim'],
};

function filterGames(filter, btn) {
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.game-card').forEach(card => {
    const id = card.dataset.game;
    const show = filter === 'all' || (FILTER_MAP[filter] || []).includes(id);
    card.style.display = show ? '' : 'none';
  });
}

async function cancelServer(id) {
  if (!confirm('Cancel this server? It stays up until the billing period ends.')) return;
  const r = await fetch('/api/private/servers/' + id + '/cancel', { method: 'POST' });
  const d = await r.json();
  if (d.ok) { alert(d.message); location.reload(); }
  else alert('Error: ' + (d.error || 'Unknown error'));
}

// Auto-refresh if any server is still provisioning
const provisioning = ${JSON.stringify(servers.some(s => !s.ready))};
if (provisioning) setTimeout(() => location.reload(), 30000);
</script>
</body>
</html>`;
}

function buildSuccessHTML(user, game) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Server Ordered — MadLadsLab</title>
  <meta http-equiv="refresh" content="6;url=/private-servers">
  <style>
    body{font-family:Inter,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}
    .box{max-width:480px;padding:40px}
    .icon{font-size:64px;margin-bottom:16px}
    h1{font-size:24px;font-weight:700;margin-bottom:8px}
    p{color:#737373;line-height:1.7;font-size:14px}
    a{color:#22c55e}
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">${game.emoji}</div>
    <h1>${game.name} server ordered!</h1>
    <p>Your private server is spinning up on a dedicated Linode. Setup takes about 10–15 minutes.<br><br>
    Redirecting to your <a href="/private-servers">server dashboard</a> in a moment…</p>
  </div>
</body>
</html>`;
}

function buildErrorHTML(msg) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error — MadLadsLab</title>
<style>body{font-family:Inter,sans-serif;background:#0a0a0a;color:#e5e5e5;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center}.box{max-width:480px;padding:40px}h1{color:#ef4444;margin-bottom:12px}p{color:#737373}a{color:#22c55e}</style>
</head>
<body><div class="box"><h1>Something went wrong</h1><p>${msg}<br><br><a href="/private-servers">← Back</a></p></div></body>
</html>`;
}

module.exports = router;
