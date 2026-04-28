import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import helmet from 'helmet';
import session from 'express-session';
import MongoStore from 'connect-mongo';

import { connectDB } from './plugins/mongo.js';
import passport from './plugins/passport.js';
import { config } from './config/config.js';

import indexRouter from './routes/index.js';
import authRouter from './routes/auth.js';
import trialRouter from './routes/trial.js';
import checkoutRouter from './routes/checkout.js';
import webhooksRouter from './routes/webhooks.js';
import accountRouter from './routes/account.js';
import downloadRouter from './routes/download.js';
import licenseApiRouter from './routes/api/license.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

// Stripe webhooks need raw body — mount BEFORE express.json()
app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: config.SESHSEC,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: config.DB_URL, dbName: config.DB_NAME, collectionName: 'sessions' }),
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

// Connect Mongo on boot
connectDB().catch(err => {
  console.error('[media-hasher] Mongo connect failed:', err.message);
  process.exit(1);
});

// Routes
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/trial', trialRouter);
app.use('/checkout', checkoutRouter);
app.use('/webhooks', webhooksRouter);
app.use('/account', accountRouter);
app.use('/download', downloadRouter);
app.use('/api/license', licenseApiRouter);

// Health
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'media-hasher' }));

// 404
app.use((req, res) => {
  if (req.accepts('html')) return res.status(404).render('404', { user: req.user || null });
  res.status(404).json({ error: 'not_found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[media-hasher]', err);
  if (req.accepts('html')) {
    return res.status(err.status || 500).render('error', { user: req.user || null, message: err.message || 'Server error' });
  }
  res.status(err.status || 500).json({ error: err.message || 'server_error' });
});

export default app;
