import mongoose from "mongoose";

const configSchema = new mongoose.Schema({
  // Singleton config - only one document should exist
  singleton: {
    type: Boolean,
    default: true,
    unique: true
  },
  // Token specifications
  tokenName: {
    type: String,
    default: "Graffiti Pasta Coin"
  },
  tokenSymbol: {
    type: String,
    default: "GPC"
  },
  // Conversion rate: how many GPC per dollar spent
  conversionRate: {
    type: Number,
    default: 10, // 10 GPC per $1 spent
    min: 0
  },
  // Supply limits
  currentSupply: {
    type: Number,
    default: 0,
    min: 0
  },
  maxSupply: {
    type: Number,
    default: 100000,
    min: 0
  },
  // Franchise tracking
  openLocations: {
    type: Number,
    default: 1,
    min: 0
  },
  // Coin value tied to franchise growth
  baseValue: {
    type: Number,
    default: 0.10, // $0.10 per coin base value
    min: 0
  },
  valueMultiplier: {
    type: Number,
    default: 1.0, // Multiplied by number of locations
    min: 0
  },
  // Blockchain settings
  blockchain: {
    type: String,
    enum: ['polygon', 'avalanche', 'algorand', 'internal'],
    default: 'internal'
  },
  contractAddress: {
    type: String,
    trim: true
  },
  // Feature flags
  features: {
    qrScanning: {
      type: Boolean,
      default: true
    },
    externalWallets: {
      type: Boolean,
      default: false
    },
    redemption: {
      type: Boolean,
      default: true
    },
    transfers: {
      type: Boolean,
      default: false
    }
  },
  // Limits
  limits: {
    maxEarnPerTransaction: {
      type: Number,
      default: 1000 // Max GPC per purchase
    },
    maxRedeemPerDay: {
      type: Number,
      default: 500 // Max GPC redeemable per day
    }
  }
}, {
  timestamps: true
});

const Config = mongoose.model('GPCConfig', configSchema);

export default Config;
