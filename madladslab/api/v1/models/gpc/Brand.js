import mongoose from "mongoose";

const brandSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      minlength: 2,
      maxlength: 50
    },
    description: {
      type: String,
      maxlength: 500
    },
    logo: {
      type: String // URL to logo image
    },
    industry: {
      type: String,
      enum: ['restaurant', 'retail', 'service', 'tech', 'healthcare', 'education', 'hospitality', 'other'],
      default: 'other'
    },
    settings: {
      departments: {
        type: [String],
        default: ['kitchen', 'bar', 'floor', 'management', 'other']
      },
      currency: {
        type: String,
        default: 'USD'
      },
      timezone: {
        type: String,
        default: 'America/New_York'
      },
      businessHours: {
        type: Object,
        default: {}
      }
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'archived'],
      default: 'active'
    },
    subscription: {
      plan: {
        type: String,
        enum: ['free', 'pro', 'enterprise'],
        default: 'free'
      },
      expiresAt: {
        type: Date
      }
    }
  },
  {
    timestamps: true
  }
);

// Indexes
brandSchema.index({ slug: 1 }, { unique: true });
brandSchema.index({ owner: 1 });
brandSchema.index({ status: 1 });
brandSchema.index({ 'subscription.plan': 1 });

// Pre-save hook to generate slug from name if not provided
brandSchema.pre('save', function(next) {
  if (!this.slug && this.name) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
  next();
});

// Method to check if brand is active
brandSchema.methods.isActive = function() {
  return this.status === 'active';
};

// Method to check subscription status
brandSchema.methods.hasActiveSubscription = function() {
  if (this.subscription.plan === 'free') return true;
  if (!this.subscription.expiresAt) return false;
  return this.subscription.expiresAt > new Date();
};

const Brand = mongoose.model("Brand", brandSchema);

export default Brand;
