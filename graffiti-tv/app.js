import createError from 'http-errors';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();
const require = createRequire(import.meta.url);
const jwt = require('jsonwebtoken');
const { notifyAdmin } = require('/srv/slab/plugins/notify.cjs');

const SLAB_JWT_SECRET = process.env.SLAB_JWT_SECRET;
const SUPERADMIN_EMAILS = ['snoryder8019@gmail.com', 'scott@madladslab.com'];

function isSuperAdminEmail(email) {
  return SUPERADMIN_EMAILS.includes((email || '').toLowerCase());
}

function requireSuperAdminJWT(req, res, next) {
  const token = req.cookies?.slab_token;
  if (!token || !SLAB_JWT_SECRET) return res.status(401).json({ error: 'Unauthorized — login required' });
  try {
    const payload = jwt.verify(token, SLAB_JWT_SECRET);
    if (!isSuperAdminEmail(payload.email)) return res.status(403).json({ error: 'Superadmin access required' });
    req.adminUser = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired — please log in again' });
  }
}

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Data helpers ──────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

function readJSON(file, def = []) {
  const p = path.join(DATA_DIR, file);
  if (!existsSync(p)) return def;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return def; }
}
function writeJSON(file, data) {
  writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function getTenants() { return readJSON('tenants.json', []); }
function getTenant(slug) { return getTenants().find(t => t.slug === slug); }
function saveTenants(t) { writeJSON('tenants.json', t); }

function getTenantData(slug) {
  return readJSON(`tenant-${slug}.json`, {
    menu: [], specials: [], events: [], offerings: [], subscribers: [], analytics: { themes: {} }
  });
}
function saveTenantData(slug, d) { writeJSON(`tenant-${slug}.json`, d); }

function getLeads() { return readJSON('leads.json', []); }
function saveLeads(l) { writeJSON('leads.json', l); }

// Seed Graffiti Pasta tenant data
function ensureSeeded() {
  const d = getTenantData('graffiti-pasta');
  if (d.menu && d.menu.length) return;
  d.menu = [
    { id:1, name:'Truffle Pasta',      desc:'Black truffle, parm, butter, herbs',        price:24.99, active:true },
    { id:2, name:'Graffiti Carbonara', desc:'Guanciale, egg yolk, pecorino, black pepper',price:19.99, active:true },
    { id:3, name:'Cacio e Pepe',       desc:'Tonnarelli, pecorino romano, cracked pepper',price:17.99, active:true },
    { id:4, name:'Arrabbiata',         desc:'San Marzano, chili, garlic, basil',          price:16.99, active:true },
    { id:5, name:'Bolognese',          desc:'Slow-braised beef & pork, tagliatelle',      price:21.99, active:true },
    { id:6, name:'Amatriciana',        desc:'Guanciale, tomato, pecorino, chili',         price:18.99, active:true },
    { id:7, name:'Wood-Fired Pizza',   desc:'Rotating toppings nightly',                  price:14.99, active:true },
    { id:8, name:'Negroni',            desc:'Gin, Campari, sweet vermouth',               price:5.00,  active:true, tag:'Happy Hour' },
    { id:9, name:'Aperol Spritz',      desc:'Prosecco, Aperol, orange, soda',             price:8.99,  active:true },
  ];
  d.specials = [
    { id:1, name:'Truffle Pasta',      desc:"Chef's pick tonight", price:24.99, active:true },
    { id:2, name:'Graffiti Carbonara', desc:'A Denton original',   price:19.99, active:true },
  ];
  d.events = [
    { id:1, title:'Live Music Night',    date:'2026-04-11', time:'8:00 PM', desc:'Live band, great pasta',       active:true },
    { id:2, title:'Happy Hour',          date:'2026-04-12', time:'4:00 PM', desc:'$5 Negronis all night',        active:true },
    { id:3, title:'Graffiti Art Night',  date:'2026-04-18', time:'7:00 PM', desc:'Live art + food pairing',     active:true },
    { id:4, title:'Wine Pairing Dinner', date:'2026-04-25', time:'6:30 PM', desc:'5-course Italian feast',      active:true },
  ];
  d.offerings = [
    { id:1, title:'10% Off Your First Visit', code:'WELCOME10', desc:'Show this QR at the door',         active:true },
    { id:2, title:'Free Aperol Spritz',        code:'SPRITZ4U',  desc:'With any pasta order, Mon-Thu',   active:true },
    { id:3, title:'Happy Hour Extension',       code:'HAPPYPLUS', desc:'Extra 30 min — 7–7:30pm',        active:true },
  ];
  d.subscribers = [];
  d.analytics = { themes: {} };
  saveTenantData('graffiti-pasta', d);
}
ensureSeeded();

// ── Plan limits ───────────────────────────────────────────────────────────────
const PLANS = {
  starter: { label: 'Starter',  price: 18, maxTemplates: 3,  maxOutputs: 1 },
  pro:     { label: 'Pro',      price: 35, maxTemplates: 10, maxOutputs: 2 },
};

// ── Theme file map ─────────────────────────────────────────────────────────────
const THEME_FILES = {
  1:'template/index.ejs.bak', 2:'themes/theme2-rave.ejs',
  3:'themes/theme3-retro-diner.ejs', 4:'themes/theme4-brutalist.ejs',
  5:'themes/theme5-vaporwave.ejs', 6:'themes/theme6-newsroom.ejs',
  7:'themes/theme7-splitscreen.ejs', 8:'themes/theme8-cinema.ejs',
  9:'themes/theme9-polaroid.ejs', 10:'themes/theme10-neon-grid.ejs',
  11:'themes/theme11-horizontal.ejs', 12:'themes/theme12-typewriter.ejs',
  13:'themes/theme13-tiles.ejs', 14:'themes/theme14-minimal.ejs',
  15:'themes/theme15-stadium.ejs',
};
const SHUFFLED_ORDER = [1,8,10,3,14,6,11,2,13,5,7,12,4,15,9];

// ── Middleware: tenant auth ────────────────────────────────────────────────────
function tenantAuth(req, res, next) {
  const slug = req.params.tenant || req.session?.tenant;
  const pass = req.headers['x-tenant-pass'] || req.query.pass || req.body?.pass;
  const tenant = getTenant(slug);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  if (pass !== tenant.passwordHash) return res.status(401).json({ error: 'Unauthorized' });
  req.tenant = tenant;
  next();
}

// ── LANDING PAGE ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.render('landing'));

// ── SIGNUP (lead capture → goes to you) ──────────────────────────────────────
app.post('/api/signup', (req, res) => {
  const { name, email, business, plan, phone } = req.body;
  if (!email || !name) return res.status(400).json({ error: 'Name and email required' });
  const leads = getLeads();
  if (leads.find(l => l.email === email)) return res.json({ ok: true, msg: 'Already on the list! We\'ll be in touch.' });
  leads.push({ id: Date.now(), name, email, business: business||'', phone: phone||'', plan: plan||'starter', createdAt: new Date().toISOString(), status: 'new' });
  saveLeads(leads);
  notifyAdmin({ type: 'gftv', app: 'graffiti-tv', email, name, ip: req.ip,
    data: { 'Business': business||'', 'Plan': plan||'starter', 'Phone': phone||'' } }).catch(() => {});
  res.json({ ok: true, msg: 'Thanks! We\'ll reach out within 24 hours to get you set up.' });
});

// ── TENANT TV DISPLAY (live, no watermark) ────────────────────────────────────
app.get('/tv/:tenant', (req, res) => {
  const tenant = getTenant(req.params.tenant);
  if (!tenant || !tenant.active) return res.status(404).send('Display not found');
  res.render('tv-display', { tenant, shuffled: SHUFFLED_ORDER, total: 15 });
});

// ── TENANT PREVIEW (watermarked, non-embeddable) ──────────────────────────────
app.get('/preview/:tenant', (req, res) => {
  const tenant = getTenant(req.params.tenant);
  if (!tenant) return res.status(404).send('Not found');
  res.setHeader('X-Frame-Options', 'DENY');
  res.render('tv-preview', { tenant, shuffled: SHUFFLED_ORDER.slice(0, PLANS[tenant.plan]?.maxTemplates || 3), total: 15 });
});

// ── THEME SERVING (checks tenant plan limits) ─────────────────────────────────
app.get('/theme/:tenant/:id', (req, res) => {
  const tenant = getTenant(req.params.tenant);
  if (!tenant) return res.status(404).send('Tenant not found');
  const id = parseInt(req.params.id);
  const rel = THEME_FILES[id];
  if (!rel) return res.status(404).send('Theme not found');
  // Track analytics
  const d = getTenantData(tenant.slug);
  d.analytics = d.analytics || { themes: {} };
  d.analytics.themes[id] = (d.analytics.themes[id] || 0) + 1;
  saveTenantData(tenant.slug, d);
  try {
    const html = readFileSync(path.join(__dirname, rel), 'utf8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch(e) { res.status(500).send('Theme error'); }
});

// ── TENANT PUBLIC API (used by themes on TV) ──────────────────────────────────
app.get('/api/:tenant/menu',      (req, res) => { const d = getTenantData(req.params.tenant); res.json((d.menu||[]).filter(i=>i.active)); });
app.get('/api/:tenant/specials',  (req, res) => { const d = getTenantData(req.params.tenant); res.json((d.specials||[]).filter(i=>i.active)); });
app.get('/api/:tenant/events',    (req, res) => { const d = getTenantData(req.params.tenant); res.json((d.events||[]).filter(i=>i.active)); });
app.get('/api/:tenant/offerings', (req, res) => { const d = getTenantData(req.params.tenant); res.json((d.offerings||[]).filter(i=>i.active)); });

// ── QR offering (first active offering) ──────────────────────────────────────
app.get('/api/:tenant/offering', (req, res) => {
  const d = getTenantData(req.params.tenant);
  const offer = (d.offerings||[]).find(o => o.active);
  const tenant = getTenant(req.params.tenant);
  const base = tenant?.branding?.website || `https://graffititv.madladslab.com`;
  if (offer) {
    res.json({
      title: offer.title,
      desc: offer.desc,
      code: offer.code,
      url: `${base}/offer/${offer.code}`,
    });
  } else {
    res.json({ title: null, url: null });
  }
});

// Email signup from TV display
app.post('/api/:tenant/subscribe', (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const d = getTenantData(req.params.tenant);
  d.subscribers = d.subscribers || [];
  if (d.subscribers.find(s => s.email === email)) return res.json({ ok: true, msg: 'Already subscribed!' });
  d.subscribers.push({ email, name: name||'', date: new Date().toISOString() });
  saveTenantData(req.params.tenant, d);
  const leads = getLeads();
  leads.push({ id: Date.now(), email, name: name||'', source: `tv-signup:${req.params.tenant}`, createdAt: new Date().toISOString(), status: 'tv-subscriber' });
  saveLeads(leads);
  notifyAdmin({ type: 'gftv', app: 'graffiti-tv', email, name: name||'', ip: req.ip,
    data: { 'TV Tenant': req.params.tenant, 'Type': 'TV Subscriber' } }).catch(() => {});
  res.json({ ok: true, msg: 'Thanks for subscribing!' });
});

// ── TENANT ADMIN PANEL ────────────────────────────────────────────────────────
app.get('/admin/:tenant', (req, res) => {
  const tenant = getTenant(req.params.tenant);
  if (!tenant) return res.status(404).send('Not found');
  res.render('tenant-admin', { tenant, plans: PLANS });
});

// Tenant admin API — all require tenant password
app.use('/api/admin/:tenant', (req, res, next) => {
  const tenant = getTenant(req.params.tenant);
  if (!tenant) return res.status(404).json({ error: 'Not found' });
  const pass = req.headers['x-tenant-pass'] || req.query.pass || req.body?.pass;
  if (pass !== tenant.passwordHash) return res.status(401).json({ error: 'Unauthorized' });
  req.tenant = tenant;
  next();
});

app.get('/api/admin/:tenant/data', (req, res) => {
  const d = getTenantData(req.tenant.slug);
  res.json({ tenant: req.tenant, ...d });
});

app.get('/api/admin/:tenant/analytics', (req, res) => {
  const d = getTenantData(req.tenant.slug);
  const themes = d.analytics?.themes || {};
  res.json({
    themes,
    totalViews: Object.values(themes).reduce((a,b)=>a+b,0),
    subscribers: (d.subscribers||[]).length,
    plan: req.tenant.plan,
    planLabel: PLANS[req.tenant.plan]?.label,
  });
});

['menu','specials','events','offerings'].forEach(col => {
  app.get(`/api/admin/:tenant/${col}`,      (req, res) => res.json(getTenantData(req.tenant.slug)[col]||[]));
  app.post(`/api/admin/:tenant/${col}`,     (req, res) => {
    const d = getTenantData(req.tenant.slug);
    d[col] = d[col] || [];
    const item = { ...req.body, id: Date.now(), active: true };
    d[col].push(item);
    saveTenantData(req.tenant.slug, d);
    res.json(item);
  });
  app.put(`/api/admin/:tenant/${col}/:id`,  (req, res) => {
    const d = getTenantData(req.tenant.slug);
    d[col] = (d[col]||[]).map(i => i.id == req.params.id ? {...i,...req.body} : i);
    saveTenantData(req.tenant.slug, d);
    res.json({ ok: true });
  });
  app.delete(`/api/admin/:tenant/${col}/:id`, (req, res) => {
    const d = getTenantData(req.tenant.slug);
    d[col] = (d[col]||[]).filter(i => i.id != req.params.id);
    saveTenantData(req.tenant.slug, d);
    res.json({ ok: true });
  });
});

// ── SUPER ADMIN (you only) ────────────────────────────────────────────────────
// Super admin API — JWT gated
app.use('/api/super', requireSuperAdminJWT);

app.get('/auth/sso', (req, res) => {
  const { token } = req.query;
  if (!token || !SLAB_JWT_SECRET) return res.redirect('/');
  try {
    const payload = jwt.verify(token, SLAB_JWT_SECRET);
    if (!payload.sso) throw new Error('Not an SSO token');
    const sessionToken = jwt.sign(
      { email: payload.email, displayName: payload.displayName, googleId: payload.googleId, sso: true },
      SLAB_JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.cookie('slab_token', sessionToken, {
      httpOnly: true, secure: true, sameSite: 'lax',
      domain: '.madladslab.com', maxAge: 8 * 60 * 60 * 1000,
    });
    res.redirect('/super');
  } catch (e) {
    console.error('[graffiti-tv] SSO error:', e.message);
    res.redirect('/');
  }
});

app.get('/super', (req, res) => {
  const token = req.cookies?.slab_token;
  if (!token || !SLAB_JWT_SECRET) return res.redirect('https://madladslab.com/auth/graffititv');
  try {
    const payload = jwt.verify(token, SLAB_JWT_SECRET);
    if (!isSuperAdminEmail(payload.email)) return res.redirect('https://madladslab.com/auth/graffititv');
    res.render('super-admin');
  } catch {
    res.redirect('https://madladslab.com/auth/graffititv');
  }
});
app.get('/api/super/tenants',        (req, res) => res.json(getTenants()));
app.get('/api/super/leads',          (req, res) => res.json(getLeads()));
app.post('/api/super/tenants',       (req, res) => {
  const tenants = getTenants();
  const t = { id: req.body.slug, ...req.body, createdAt: new Date().toISOString(), active: true };
  tenants.push(t);
  saveTenants(tenants);
  // Init empty data file
  saveTenantData(t.slug, { menu:[], specials:[], events:[], offerings:[], subscribers:[], analytics:{ themes:{} } });
  res.json(t);
});
app.put('/api/super/tenants/:slug',  (req, res) => {
  const tenants = getTenants().map(t => t.slug === req.params.slug ? {...t,...req.body} : t);
  saveTenants(tenants);
  res.json({ ok: true });
});
app.delete('/api/super/tenants/:slug', (req, res) => {
  saveTenants(getTenants().filter(t => t.slug !== req.params.slug));
  res.json({ ok: true });
});
app.put('/api/super/leads/:id/status', (req, res) => {
  const leads = getLeads().map(l => l.id == req.params.id ? {...l, status: req.body.status} : l);
  saveLeads(leads);
  res.json({ ok: true });
});

// ── Legacy routes for graffiti-pasta (/api/linode, /api/gftv) ─────────────────
import apiRouter from './routes/api.js';
import linodeApiRouter from './routes/linode-api.js';
app.use('/api', apiRouter);
app.use('/api/linode', linodeApiRouter);

// Legacy TV display at root (graffiti-pasta)
app.get('/display', (req, res) => res.redirect('/tv/graffiti-pasta'));

app.use((req, res, next) => next(createError(404)));
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

export default app;
