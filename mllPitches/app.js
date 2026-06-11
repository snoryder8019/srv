import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import morgan from 'morgan';
import session from 'express-session';
import FileStoreImport from 'session-file-store';
import cookieParser from 'cookie-parser';
import passport from './plugins/auth.js';
import { attachUser } from './plugins/mllAuth.js';

import indexRouter from './routes/index.js';
import clientsRouter from './routes/clients.js';
import scopeRouter from './routes/scope.js';
import contactRouter from './routes/contact.js';
import authRouter from './routes/auth.js';
import mllSsoRouter from './routes/mllSso.js';
import adminRouter from './routes/admin.js';
import agentRouter from './routes/agent.js';
import sdRouter from './routes/sd.js';
import excelRouter from './routes/excel.js';
import dashboardRouter from './routes/dashboard.js';
import editorRouter from './routes/editor.js';
import shareRouter from './routes/share.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const FileStore = FileStoreImport(session);
app.use(
  session({
    store: new FileStore({
      path: path.join(__dirname, 'data', 'sessions'),
      ttl: 60 * 60 * 24 * 30,
      retries: 1,
      reapInterval: 60 * 60,
    }),
    secret: process.env.SESSION_SECRET || 'left-field-dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// madladslab SSO — populates req.mllUser / res.locals.mllUser when signed in.
app.use(attachUser);

app.use((req, res, next) => {
  // res.locals.user keeps legacy templates working (passport superadmin),
  // falling back to the madladslab SSO user for the shared header/nav.
  res.locals.user = req.user || req.mllUser || null;
  next();
});

app.locals.brand = {
  name: 'Left Field',
  parent: 'MadLadsLab',
  tagline: 'Pitches built like product. Out of left field, straight into the deal.',
  pillars: [
    'Efficient Development without Technical Debt',
    'Secure Custom Software',
    'Privacy and Data Sovereignty',
  ],
  contactEmail: 'scott@madladslab.com',
  site: 'https://madladslab.com',
};

app.use('/', indexRouter);
app.use('/c', clientsRouter);
app.use('/scope', scopeRouter);
app.use('/contact', contactRouter);
app.use('/auth', mllSsoRouter); // madladslab SSO (login/sso/signout) — checked before passport router
app.use('/auth', authRouter);
app.use('/dashboard', dashboardRouter);
app.use('/editor', editorRouter);
app.use('/share', shareRouter);
app.use('/admin', adminRouter);
app.use('/api/agent', agentRouter);
app.use('/api/sd', sdRouter);
app.use('/api/excel', excelRouter);

app.use((req, res) => {
  res.status(404).render('error', { title: 'Not found', message: `No pitch at ${req.originalUrl}` });
});

app.use((err, req, res, _next) => {
  console.error('[mllPitches] error:', err);
  res.status(500).render('error', { title: 'Server error', message: err.message || 'Unexpected error' });
});

export default app;
