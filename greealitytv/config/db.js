const mongoose = require('mongoose');

mongoose.connect(process.env.DB_URL + '/' + process.env.DB_NAME)
  .then(() => console.log('MongoDB connected — madLadsLab (grv_ collections)'))
  .catch(err => console.error('MongoDB connection error:', err));
