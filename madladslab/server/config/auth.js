const authRouter = require('./routes/auth');

module.exports = function(app) {
  app.use('/auth', authRouter);
};
