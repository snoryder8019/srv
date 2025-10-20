import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  walletAddress: {
    type: String,
    required: true,
    trim: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  purchaseAmount: {
    type: Number, // Dollar amount of purchase
    required: true,
    min: 0
  },
  type: {
    type: String,
    enum: ['earn', 'redeem', 'transfer', 'bonus'],
    default: 'earn'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  },
  locationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LBBLocation',
    required: false
  },
  qrCode: {
    type: String,
    trim: true
  },
  transactionHash: {
    type: String, // For blockchain transactions
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, {
  timestamps: true
});

// Indexes for queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ walletAddress: 1, createdAt: -1 });
transactionSchema.index({ locationId: 1, createdAt: -1 });
transactionSchema.index({ type: 1, status: 1 });

const Transaction = mongoose.model('GPCTransaction', transactionSchema);

export default Transaction;
