/**
 * Towers (TD) - main app entry.
 * Express + EJS + Socket.IO + Mongo + Passport. Domain: towers.madladslab.com
 *
 * Service map (debugging guide):
 *   /              -> routes/pages.js (EJS views)
 *   /auth/*        -> routes/auth.js (Google OAuth)
 *   /api/v1/*      -> api/v1/index.js (REST API)
 *   /assets/*      -> public/assets (static GLTF, textures)
 *   /js/*, /css/*  -> public/javascripts, public/stylesheets
 *   socket.io      -> services/socket-handlers.js
 */
import express from 'express';
import http from 'http';
import { Server as SocketServer } from 'socket.io';
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
import { attachSocket } from './services/socket-handlers.js';
import { configurePassport } from './services/auth/passport.js';
import { attachUserToLocals } from './api/v1/middleware/auth.js';
import apiV1 from './api/v1/index.js';
import pagesRouter from './routes/pages.js';
import authRouter from './routes/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server, { cors: { origin: '*' } });

// Trust proxy for nginx in front
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security + logging
app.use(helmet({
  contentSecurityPolicy: false, // dev: tighten before prod
  crossOriginEmbedderPolicy: false,
}));
app.use(cors());
app.use(compression());
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ----- Sessions (MongoStore if DB up, fallback to memory) -----------------
function buildSession() {
  const opts = {
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.env === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30d
    },
  };
  if (config.db.url) {
    opts.store = MongoStore.create({
      mongoUrl: config.db.url,
      dbName: config.db.name,
      collectionName: 'sessions',
      ttl: 60 * 60 * 24 * 30,
    });
  } else {
    console.warn('[session] using memory store - DB_URL not set');
  }
  return session(opts);
}
app.use(buildSession());

// ----- Passport -----------------------------------------------------------
const passport = configurePassport();
app.use(passport.initialize());
app.use(passport.session());

// Make user available to all views
app.use(attachUserToLocals);

// Static
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/js', express.static(path.join(__dirname, 'public', 'javascripts')));
app.use('/css', express.static(path.join(__dirname, 'public', 'stylesheets')));

// Locals for templates
app.use((req, res, next) => {
  res.locals.domain = config.domain;
  res.locals.env = config.env;
  next();
});

// Routes
app.use('/auth', authRouter);
app.use('/api/v1', apiV1);
app.use('/', pagesRouter);

// 404 + error handlers
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found', path: req.path });
});

app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(err.status || 500).json({ success: false, error: err.message });
});

// Sockets
attachSocket(io);

// Boot
async function start() {
  reportConfigStatus();
  if (config.db.url) {
    try { await connectDb(); }
    catch (err) { console.warn('[boot] DB unavailable - degraded mode'); }
  } else {
    console.warn('[boot] DB_URL empty - skipping connection');
  }

  server.listen(config.port, () => {
    console.log('================================');
    console.log(` Towers (TD) v0.2.0`);
    console.log(` Domain: https://${config.domain}`);
    console.log(` Listening on port ${config.port}`);
    console.log(` Env: ${config.env}`);
    console.log('================================');
  });
}

start();

export { app, server, io };
