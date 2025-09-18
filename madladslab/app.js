import createError  from 'http-errors';
import express  from 'express';
import path  from 'path';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import passport from "passport";
import session from "express-session";
import MongoStore from 'connect-mongo';
import { fileURLToPath } from 'url';

import indexRouter from './routes/index.js'
import apiRouter from './api/index.js'
import {connectDB} from './plugins/mongo/mongo.js';
// /app.js
const app = express();
// ...
app.use(cookieParser(process.env.COOKIE_SECRET || "dev"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.set('trust proxy', 1);  // Trust Apache proxy


app.use(
  session({
    secret: process.env.SESHSEC || "someSecret",
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.DB_URL,  // Ensure this is set in .env
      collectionName: 'sessions'
    }),
    cookie: { secure: true, httpOnly: true, sameSite: 'strict' },
  })
);


// Initialize Passport & Session Middleware
app.use(passport.initialize());
app.use(passport.session());

// app.use((req, res, next) => {
//   console.log("Session ID:", req.session.id);
//   console.log("Session User:", req.session.user);
//   console.log("Request User:", req.user);
//   next();
// });


connectDB();
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/',indexRouter);
app.use('/api',apiRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('errors/errors.ejs', { message: err.message, error: res.locals.error });
});

export default app;
