import mongoose from "mongoose";

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  address: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  totalEarned: {
    type: Number,
    default: 0,
    min: 0
  },
  totalRedeemed: {
    type: Number,
    default: 0,
    min: 0
  },
  totalPurchases: {
    type: Number,
    default: 0,
    min: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // For external wallet integration (MetaMask, etc.)
  externalWalletAddress: {
    type: String,
    trim: true,
    sparse: true
  },
  lastTransactionAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes
walletSchema.index({ userId: 1 });
walletSchema.index({ address: 1 });
walletSchema.index({ externalWalletAddress: 1 });

const Wallet = mongoose.model('GPCWallet', walletSchema);

export default Wallet;
