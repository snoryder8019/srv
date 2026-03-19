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

import indexRouter from './routes/index.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

// Session (for OAuth state only — admin sessions use JWT)
app.use(
  session({
    secret: config.SESHSEC,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: config.DB_URL, collectionName: 'cw_sessions' }),
    cookie: { secure: config.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax' },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Connect DB
connectDB();

// Routes
app.use('/', indexRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter);

// 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).send(err.message || 'Server error');
});

export default app;
