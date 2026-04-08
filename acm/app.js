require('dotenv').config();

const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const passport = require('./config/passport');

const indexRouter = require('./routes/index');
const authRouter = require('./routes/auth');
const adminRouter = require('./routes/admin');
const emailMarketingRouter = require('./routes/emailMarketing');
const promosRouter = require('./routes/promos');
const agentRouter = require('./routes/agent');
const blogRouter = require('./routes/blog');
const assetsRouter = require('./routes/assets');

const app = express();
app.set('trust proxy', 1);

// MongoDB
const MONGO_URI = `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// View engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'dev'));
app.use(express.static(path.join(__dirname, 'public')));

// Session
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'dev',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
});
app.use(sessionMiddleware);

// Passport
app.use(passport.initialize());
app.use(passport.session());

// Superadmin gateway
const { gatewayRoute } = require('/srv/gateway.cjs');
app.get('/gateway', gatewayRoute({
  secret: process.env.SESSION_SECRET || process.env.SESHSEC,
  appName: 'acm',
  findOrCreateAdmin: async (email) => {
    const User = require('./models/User');
    let user = await User.findOne({ email });
    if (!user) user = await User.create({ email, displayName: email.split('@')[0], role: 'admin', isAdmin: true, provider: 'gateway' });
    else if (!user.isAdmin) { user.isAdmin = true; await user.save(); }
    return user;
  },
}));

// Make user available to all views
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  next();
});

// Routes
app.use('/', indexRouter);
app.use('/', authRouter);
app.use('/', adminRouter);
app.use('/', emailMarketingRouter);
app.use('/', promosRouter);
app.use('/', agentRouter);
app.use('/', blogRouter);
app.use('/', assetsRouter);

// 404
app.use((req, res, next) => {
  next(createError(404));
});

// Error handler
app.use((err, req, res, next) => {
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
