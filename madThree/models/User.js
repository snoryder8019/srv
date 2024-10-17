const mongoose = require('mongoose');
const passportLocalMongoose = require('passport-local-mongoose');

// Check if the model has already been registered
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

// Plugin for password hashing and authentication
UserSchema.plugin(passportLocalMongoose);

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
