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
import { attachLocals } from './middleware/locals.js';

import indexRouter from './routes/index.js';
import authRouter from './routes/auth.js';
import calendarRouter from './routes/calendar.js';
import feedRouter from './routes/feed.js';
import adminRouter from './routes/admin.js';
import apiV1Router from './routes/api/v1.js';
import googleWebhookRouter from './routes/webhooks/google.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true },
}));

app.use(session({
  secret: config.SESHSEC,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: config.DB_URL, dbName: config.DB_NAME, collectionName: 'sessions' }),
  cookie: {
    secure: config.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    ...(config.NODE_ENV === 'production' && config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  },
}));

app.use(passport.initialize());
app.use(passport.session());

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(attachLocals);

await connectDB();

app.use('/auth', authRouter);
app.use('/api/v1', apiV1Router);
app.use('/webhooks/google', googleWebhookRouter);
app.use('/calendar', calendarRouter);
app.use('/feed', feedRouter);
app.use('/admin', adminRouter);
app.use('/', indexRouter);

app.use((req, res) => res.status(404).render('404'));

app.use((err, req, res, next) => {
  console.error('[familyCalendar]', err);
  res.status(err.status || 500).send(err.message || 'Server error');
});

export default app;
