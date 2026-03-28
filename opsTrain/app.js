require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const passport = require('passport');
const cors = require('cors');

const connectDB = require('./plugins/mongo');
require('./plugins/passport');

const locales = {
  en: require('./locales/en.json'),
  es: require('./locales/es.json')
};

const app = express();

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(morgan('dev'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret: process.env.SESHSEC,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: `${process.env.DB_URL}/${process.env.DB_NAME}`,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Locals — make user + lang available in all views
app.use((req, res, next) => {
  // Language toggle: ?lang=es or ?lang=en persists to session
  if (req.query.lang === 'es' || req.query.lang === 'en') {
    req.session.lang = req.query.lang;
  }
  const lang = req.session?.lang || 'en';
  const strings = locales[lang] || locales.en;
  res.locals.user = req.user || null;
  res.locals.lang = lang;
  res.locals.domain = process.env.DOMAIN || 'https://ops-train.madladslab.com';
  // t('nav.dashboard') -> looks up nested key
  res.locals.t = function(key) {
    return key.split('.').reduce((obj, k) => obj && obj[k], strings) || key;
  };
  next();
});

// Connect MongoDB then mount routes
connectDB().then(() => {
  // Routes
  const indexRouter = require('./routes/index');
  const authRouter = require('./routes/auth');
  const adminRouter = require('./routes/admin');
  const scanRouter = require('./routes/scan');
  const shiftRouter = require('./routes/shift');
  const liveRouter = require('./routes/live');
  const superadminRouter = require('./routes/superadmin');

  const startRouter = require('./routes/start');

  app.use('/', indexRouter);
  app.use('/start', startRouter);
  app.use('/auth', authRouter);
  app.use('/admin', adminRouter);
  app.use('/scan', scanRouter);
  app.use('/live', liveRouter);
  app.use('/superadmin', superadminRouter);
  app.use('/shift', shiftRouter);

  // 404
  app.use((req, res) => {
    res.status(404).render('errors/error', {
      title: '404',
      message: 'Page not found'
    });
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('[opsTrain Error]', err);
    res.status(err.status || 500).render('errors/error', {
      title: 'Error',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
  });
}).catch(err => {
  console.error('[opsTrain] Failed to connect to MongoDB:', err);
  process.exit(1);
});

module.exports = app;
