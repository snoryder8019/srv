import mongoose from "mongoose";

// User schema - wraps the existing 'users' collection
// This allows mongoose models to reference users via ObjectId
const userSchema = new mongoose.Schema(
  {
    providerID: String,
    provider: String,
    email: {
      type: String,
      required: true,
      unique: true
    },
    displayName: String,
    firstName: String,
    lastName: String,
    password: String,
    isAdmin: {
      type: Boolean,
      default: false
    },
    isAustins: {
      type: Boolean,
      default: false
    },
    isBackoffice: {
      type: String,
      enum: ['admin', 'manager', 'staff', null],
      default: null
    },
    contest: {
      type: String,
      default: 'player'
    },
    notifications: [String],
    images: [String],
    subscription: {
      type: String,
      default: 'free'
    }
  },
  {
    timestamps: true,
    collection: 'users' // Use the existing 'users' collection
  }
);

// Method to get display name
userSchema.methods.getName = function() {
  return this.displayName || `${this.firstName || ''} ${this.lastName || ''}`.trim() || this.email;
};

// Add a getter for name that works without virtual
userSchema.path('displayName').get(function(value) {
  return value || `${this.firstName || ''} ${this.lastName || ''}`.trim() || this.email;
});

const User = mongoose.model("User", userSchema);

export default User;
