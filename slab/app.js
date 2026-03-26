import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import passport from './plugins/passport.js';
import { connectDB } from './plugins/mongo.js';
import { config } from './config/config.js';
import { resolveTenant } from './middleware/tenant.js';

import indexRouter from './routes/index.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import meetingsRouter from './routes/meetings.js';
import payRouter from './routes/pay.js';
import webhooksRouter from './routes/webhooks.js';
import trackingRouter from './routes/tracking.js';
import onboardingRouter from './routes/onboarding.js';
import superadminRouter from './routes/superadmin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const BOOT_TIME = Date.now();
const MAINTENANCE_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use(
  session({
    secret: config.SESHSEC,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: config.DB_URL, collectionName: 'sessions' }),
    cookie: { secure: config.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' },
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(logger('dev'));

// Stripe webhooks need raw body — must be before express.json()
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
app.use('/start/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Tenant resolution — sets req.tenant, req.db, res.locals.brand ───────────
app.use(resolveTenant);

// Maintenance cooldown — 10 min after boot
app.use((req, res, next) => {
  const elapsed = Date.now() - BOOT_TIME;
  res.locals.maintenanceCooldown = elapsed < MAINTENANCE_COOLDOWN_MS
    ? Math.ceil((MAINTENANCE_COOLDOWN_MS - elapsed) / 1000)
    : 0;
  next();
});

connectDB();

app.use('/start', onboardingRouter);
app.use('/superadmin', superadminRouter);

// ── Platform landing page (slab.madladslab.com) ─────────────────────────────
app.get('/', (req, res, next) => {
  if (!req.tenant) return res.render('landing');
  next();
});

app.use('/t', trackingRouter);
app.use('/meeting', meetingsRouter);
app.use('/pay', payRouter);
app.use('/webhooks', webhooksRouter);
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).send(err.message || 'Server error');
});

export default app;
