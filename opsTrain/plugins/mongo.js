const mongoose = require('mongoose');

async function connectDB() {
  const uri = `${process.env.DB_URL}/${process.env.DB_NAME}`;
  await mongoose.connect(uri);
  console.log(`[opsTrain] MongoDB connected: ${process.env.DB_NAME}`);
}

module.exports = connectDB;
