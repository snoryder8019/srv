/**
 * Madlands — main app entry.
 * Express + EJS + Mongo (optional) + Platform SSO. Domain: madlands.madladslab.com
 *
 * Service map:
 *   /                -> routes/pages.js  (the blank hex map view)
 *   /auth/*          -> routes/auth.js   (games.madladslab.com SSO + dev login)
 *   /admin/*         -> routes/admin.js  (builder shell + focused agents; canAdmin-gated)
 *   /siege/*         -> routes/siege.js  (open attack instances in the engine + return)
 *   /js/*, /css/*    -> public/javascripts, public/stylesheets
 *   /assets/*        -> public/assets    (SD scene art: sky-env.png, ground-terrain.png)
 *
 * Built backward from the towers (td) render core: scene.js (camera) +
 * hex-board.js / hex-grid.js (hex layout) are reused verbatim.
 */
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import morgan from 'morgan';
import compression from 'compression';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import MongoStore from 'connect-mongo';

import config, { reportConfigStatus } from './config/index.js';
import { connectDb } from './services/db.js';
import pagesRouter from './routes/pages.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import worldRouter from './routes/world.js';
import playRouter from './routes/play.js';
import siegeRouter from './routes/siege.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1); // apache sits in front
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(compression());
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Sessions — persisted in Mongo so logins SURVIVE service restarts/deploys.
// Falls back to the default MemoryStore only if no DB is configured.
function buildSessionStore() {
  if (!config.db.url) {
    console.warn('[session] no DB_URL — using in-memory store (logins drop on restart)');
    return undefined;
  }
  return MongoStore.create({
    mongoUrl: config.db.url,
    dbName: config.db.name,
    collectionName: 'sessions',
    ttl: 60 * 60 * 24 * 7, // 7d
  });
}

app.use(session({
  name: 'madlands.sid',
  store: buildSessionStore(),
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: true, // served over HTTPS via apache; trust proxy is set
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
}));

// Soft-attach the session user to view locals (always passes through).
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  next();
});

// Static
app.use('/js', express.static(path.join(__dirname, 'public/javascripts')));
app.use('/css', express.static(path.join(__dirname, 'public/stylesheets')));
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

// Routes
app.use('/auth', authRouter);
app.use('/admin', adminRouter);
app.use('/api', worldRouter);
app.use('/api/play', playRouter);
app.use('/siege', siegeRouter);
app.use('/', pagesRouter);

// Health
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'madlands', port: config.port }));

server.listen(config.port, () => {
  reportConfigStatus();
  console.log(`[madlands] listening on :${config.port}  (${config.publicUrl})`);
  connectDb(); // non-blocking; map renders even if this fails
});
