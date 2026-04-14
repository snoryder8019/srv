require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const morgan = require('morgan');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const { Server } = require('socket.io');

// Passport config
require('./config/passport');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ── MongoDB ──
const seedContent = require('./utils/seedContent');
mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');
    await seedContent();
  })
  .catch(err => console.error('MongoDB error:', err));

// ── Middleware ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Sessions ──
app.use(session({
  secret: process.env.SESSION_SECRET || 'mm-dev-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'mm.sessions'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
  }
}));

// ── Passport ──
app.use(passport.initialize());
app.use(passport.session());

// ── Locals (available in all EJS views) ──
const SiteTheme = require('./models/SiteTheme');
app.use(async (req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.siteName = process.env.SITE_NAME || 'Mobile Meadows';
  res.locals.siteTagline = process.env.SITE_TAGLINE || '';
  try {
    res.locals.siteTheme = await SiteTheme.getActive();
  } catch (e) {
    res.locals.siteTheme = { activeTheme: 'default', customColors: {} };
  }
  next();
});

// ── Routes ──
app.use('/', require('./routes/public'));
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/booking', require('./routes/booking'));
app.use('/api', require('./routes/api'));

// ── Socket.IO ──
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

// Make io accessible in routes
app.set('io', io);

// ── 404 ──
app.use((req, res) => {
  res.status(404).render('pages/public/404', { title: 'Not Found' });
});

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('pages/public/error', {
    title: 'Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ── Start ──
const PORT = process.env.PORT || 3700;
server.listen(PORT, () => {
  console.log(`Mobile Meadows running on port ${PORT}`);
});
