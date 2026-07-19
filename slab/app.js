import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import passport from './plugins/passport.js';
import { connectDB } from './plugins/mongo.js';
import { config } from './config/config.js';
import { resolveTenant } from './middleware/tenant.js';
import { trackRouteUsage, startRouteUsageFlusher } from './plugins/routeUsage.js';
import { seoMiddleware } from './middleware/seo.js';
import { recordServerError, ensureObserveIndexes } from './plugins/observe.js';

import indexRouter from './routes/index.js';
import seoRouter from './routes/seo.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import meetingsRouter from './routes/meetings.js';
import bookingRouter from './routes/booking.js';
import careersRouter from './routes/careers.js';
import marketplacePublicRouter from './routes/marketplace.js';
import payRouter from './routes/pay.js';
import engageRouter from './routes/engage.js';
import webhooksRouter from './routes/webhooks.js';
import trackingRouter from './routes/tracking.js';
import onboardingRouter from './routes/onboarding.js';
import superadminRouter from './routes/superadmin.js';
import delegatesRouter from './routes/delegates.js';
import networkRouter from './routes/network.js';
import ticketApiRouter from './routes/ticketApi.js';
import formsRouter from './routes/forms.js';
import agentRouter from './routes/agent.js';
import { captchaRouter } from './plugins/captcha.js';
// REMOVED: Huginn unwired
// import huginnWebhookRouter from './routes/huginn-webhook.js';
// import huginnMcpRouter from './routes/huginn-mcp.js';
import { mountTenantRoutes } from './routes/tenants/loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const BOOT_TIME = Date.now();
const MAINTENANCE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,        // EJS templates use inline scripts/styles
  crossOriginEmbedderPolicy: false,    // allows loading external fonts/images
  crossOriginOpenerPolicy: false,      // allows iframe contentDocument access (design editor)
  crossOriginResourcePolicy: false,    // allows same-origin iframe resource loading
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

app.use(
  session({
    secret: config.SESHSEC,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: config.DB_URL, collectionName: 'sessions' }),
    cookie: {
      secure: config.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      ...(config.NODE_ENV === 'production' ? { domain: '.madladslab.com' } : {}),
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(logger('dev'));

// Stripe webhooks need raw body — must be before express.json()
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/start/webhook', express.raw({ type: 'application/json' }));
// DISABLED FOR RELEASE: Social Activity Meta webhook ingestion
// app.use('/webhooks/meta', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
// Self-host the @imgly/background-removal ESM bundle (the asset generator's
// in-browser background remover dynamically imports /vendor/imgly/index.mjs).
// The model weights/wasm still load from imgly's official CDN (the lib default).
app.use('/vendor/imgly', express.static(path.join(__dirname, 'node_modules/@imgly/background-removal/dist')));
// onnxruntime-web — the imgly bundle dynamically imports the bare specifier
// "onnxruntime-web"; an import map in the page (see assets/social.ejs) points
// it here so the browser can resolve it without a bundler.
app.use('/vendor/onnxruntime-web', express.static(path.join(__dirname, 'node_modules/onnxruntime-web/dist')));

// ── Tenant resolution — sets req.tenant, req.db, res.locals.brand ───────────
app.use(resolveTenant);

// ── Route-usage tracking — records per-tenant endpoint hits for the superadmin
// usage dashboard (drives "build for what's actually used"). Buffered + flushed.
app.use(trackRouteUsage);

// ── SEO / AEO / GEO / AAO — sets res.locals.seo and SEO headers ─────────────
app.use(seoMiddleware);

// Tenant-aware SEO files (robots.txt, sitemap.xml, llms.txt, agents.json)
app.use('/', seoRouter);

// Maintenance cooldown — 10 min after boot
app.use((req, res, next) => {
  const elapsed = Date.now() - BOOT_TIME;
  res.locals.maintenanceCooldown = elapsed < MAINTENANCE_COOLDOWN_MS
    ? Math.ceil((MAINTENANCE_COOLDOWN_MS - elapsed) / 1000)
    : 0;
  next();
});

connectDB();
startRouteUsageFlusher();

app.use('/start', onboardingRouter);
app.use('/superadmin', superadminRouter);
app.use('/delegates', delegatesRouter);
app.use('/network', networkRouter);
// REMOVED: Huginn unwired
// app.use('/huginn/mcp', huginnMcpRouter);
// app.use('/huginn', huginnWebhookRouter);

// ── Tenant-specific custom routes (routes/tenants/<name>/) ─────────────────
await mountTenantRoutes(app);

// ── Platform landing page (slab.madladslab.com) ─────────────────────────────
app.get('/', async (req, res, next) => {
  if (!req.tenant) {
    // Load slab tenant's design + copy so the platform landing uses admin settings
    try {
      const { getSlabDb, getTenantDb } = await import('./plugins/mongo.js');
      const slab = getSlabDb();
      const tenant = await slab.collection('tenants').findOne({ 'meta.subdomain': 'slab' });
      if (tenant) {
        const tdb = getTenantDb(tenant.db);
        const [rawDesign, rawCopy, rawLogos, rawModels] = await Promise.all([
          tdb.collection('design').find({}).toArray(),
          tdb.collection('copy').find({}).toArray(),
          tdb.collection('brand_images').find({}).toArray(),
          tdb.collection('brand_models').find({}).toArray(),
        ]);
        const { DESIGN_DEFAULTS } = await import('./routes/admin/design.js');
        const design = { ...DESIGN_DEFAULTS };
        for (const d of rawDesign) design[d.key] = d.value;
        const copy = {};
        for (const c of rawCopy) copy[c.key] = c.value;
        const logos = {};
        for (const l of rawLogos) logos[l.slot] = l.url;
        const brandModels = {};
        for (const m of rawModels) brandModels[m.slot] = m.url;
        return res.render('landing', { brand: tenant.brand, design, copy, logos, brandModels });
      }
    } catch (err) { console.error('[platform-landing]', err.message); }
    return res.render('landing');
  }
  next();
});

app.use('/api/tickets', ticketApiRouter);
app.use('/t', trackingRouter);
app.use('/meeting', meetingsRouter);
app.use('/book', bookingRouter);
app.use('/careers', careersRouter);
app.use('/marketplace', marketplacePublicRouter);
app.use('/pay', payRouter);
app.use('/engage', engageRouter);
app.use('/webhooks', webhooksRouter);
app.use('/forms', formsRouter);
app.use('/captcha', captchaRouter);
app.use('/agent', agentRouter);
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
  // Malformed request URIs (bot/scanner probes with bad percent-encoding, e.g.
  // "..%C0%AF..%C0%AF.env") throw a URIError with status 400 during param
  // decoding. Log a one-liner instead of a full stack trace, then 400.
  if (err instanceof URIError || err.status === 400) {
    console.warn(`[bad-request] ${req.method} ${req.originalUrl} — ${err.message}`);
    return res.status(400).send('Bad request');
  }
  console.error(err);
  recordServerError({ err, req, kind: 'server' });   // best-effort, queryable in /superadmin/errors
  res.status(err.status || 500).send(err.message || 'Server error');
});

// Process-level traps — capture crashes that never reach the Express handler.
// Log only; do not exit (systemd would restart, but a single bad promise
// shouldn't take the whole app down during the testing phase).
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
  recordServerError({ err: reason instanceof Error ? reason : new Error(String(reason)), kind: 'unhandledRejection' });
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  recordServerError({ err, kind: 'uncaughtException' });
});

// Build the TTL/query indexes for the observability feeds once the DB is up
// (connectDB runs from bin/www after this module loads).
setTimeout(() => { ensureObserveIndexes(); }, 8000);

export default app;
