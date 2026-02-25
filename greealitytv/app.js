require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const passport = require('passport');
const methodOverride = require('method-override');
const flash = require('connect-flash');
const path = require('path');

require('./config/db');
require('./config/passport')(passport);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

app.use(session({
  secret: process.env.SESHSEC,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.DB_URL + '/' + process.env.DB_NAME
  })
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

app.use('/', require('./routes/index'));
app.use('/auth', require('./routes/auth'));
app.use('/posts', require('./routes/posts'));
app.use('/videos', require('./routes/videos'));
app.use('/votes', require('./routes/petitions'));
app.use('/profile', require('./routes/profile'));
app.use('/admin', require('./routes/admin'));

const PORT = process.env.PORT || 3400;
app.listen(PORT, () => console.log(`GreeAlityTV running on port ${PORT}`));
