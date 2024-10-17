const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String },  // Password will be handled by passport-local-mongoose
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

// Add Passport-Local Mongoose plugin to handle hashing and authentication methods
UserSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model('User', UserSchema);
