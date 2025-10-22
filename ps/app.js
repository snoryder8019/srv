import createError from 'http-errors';
import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import passport from 'passport';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

import indexRouter from './routes/index.js';
import apiRouter from './api/index.js';
import { connectDB } from './plugins/mongo/mongo.js';
import { loadActiveCharacter } from './middlewares/characterSession.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);

// Cookie parser
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev'));

// Session configuration
app.use(
  session({
    secret: process.env.SESHSEC || 'stringbornSecret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL,
      collectionName: 'sessions'
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
    },
  })
);

// Initialize Passport & Session Middleware
app.use(passport.initialize());
app.use(passport.session());

// Load active character middleware (must be after passport)
app.use(loadActiveCharacter);

// Connect to database
connectDB();

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/', indexRouter);
app.use('/api', apiRouter);

// Catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// Error handler
app.use(function(err, req, res, next) {
  // Set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // Render the error page
  res.status(err.status || 500);
  res.render('errors/error', {
    message: err.message,
    error: res.locals.error
  });
});

export default app;
