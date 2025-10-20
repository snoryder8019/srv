import Transaction from "../models/gpc/Transaction.js";
import Wallet from "../models/gpc/Wallet.js";
import Config from "../models/gpc/Config.js";
import crypto from "crypto";

// ============ CONFIG MANAGEMENT ============

// Get or create config
export async function getConfig() {
  let config = await Config.findOne({ singleton: true });

  if (!config) {
    config = new Config({ singleton: true });
    await config.save();
  }

  return config;
}

// Update config (admin only)
export async function updateConfig(updates) {
  const config = await getConfig();
  Object.assign(config, updates);
  await config.save();
  return config;
}

// Calculate current coin value based on franchise growth
export async function calculateCoinValue() {
  const config = await getConfig();
  return config.baseValue * (1 + (config.openLocations - 1) * config.valueMultiplier * 0.1);
}

// ============ WALLET MANAGEMENT ============

// Generate unique wallet address
function generateWalletAddress(userId) {
  const hash = crypto.createHash('sha256').update(`GPC-${userId}-${Date.now()}`).digest('hex');
  return `GPC${hash.substring(0, 40)}`.toUpperCase();
}

// Get or create wallet for user
export async function getWallet(userId) {
  let wallet = await Wallet.findOne({ userId });

  if (!wallet) {
    wallet = new Wallet({
      userId,
      address: generateWalletAddress(userId),
      balance: 0
    });
    await wallet.save();
  }

  return wallet;
}

// Get wallet by address
export async function getWalletByAddress(address) {
  return await Wallet.findOne({ address });
}

// Link external wallet (MetaMask, etc.)
export async function linkExternalWallet(userId, externalAddress) {
  const wallet = await getWallet(userId);
  wallet.externalWalletAddress = externalAddress;
  await wallet.save();
  return wallet;
}

// ============ TRANSACTION MANAGEMENT ============

// Send coins to user based on purchase amount
export async function sendCoins(userId, purchaseAmount, locationId = null, qrCode = null) {
  const config = await getConfig();

  // Check supply limits
  if (config.currentSupply >= config.maxSupply) {
    throw new Error("Maximum coin supply reached. Cannot issue more coins.");
  }

  // Calculate GPC amount based on purchase
  let gpcAmount = Math.floor(purchaseAmount * config.conversionRate);

  // Apply max earn limit
  if (gpcAmount > config.limits.maxEarnPerTransaction) {
    gpcAmount = config.limits.maxEarnPerTransaction;
  }

  // Check if this would exceed max supply
  if (config.currentSupply + gpcAmount > config.maxSupply) {
    gpcAmount = config.maxSupply - config.currentSupply;
  }

  // Get or create wallet
  const wallet = await getWallet(userId);

  // Create transaction
  const transaction = new Transaction({
    userId,
    walletAddress: wallet.address,
    amount: gpcAmount,
    purchaseAmount,
    type: 'earn',
    status: 'completed',
    locationId,
    qrCode,
    description: `Earned ${gpcAmount} GPC from $${purchaseAmount.toFixed(2)} purchase`
  });

  await transaction.save();

  // Update wallet balance
  wallet.balance += gpcAmount;
  wallet.totalEarned += gpcAmount;
  wallet.totalPurchases += purchaseAmount;
  wallet.lastTransactionAt = new Date();
  await wallet.save();

  // Update config supply
  config.currentSupply += gpcAmount;
  await config.save();

  return { transaction, wallet, config };
}

// Redeem coins (subtract from balance)
export async function redeemCoins(userId, amount, description = null) {
  const config = await getConfig();

  if (!config.features.redemption) {
    throw new Error("Redemption is currently disabled");
  }

  const wallet = await getWallet(userId);

  if (wallet.balance < amount) {
    throw new Error(`Insufficient balance. Available: ${wallet.balance} GPC`);
  }

  // Check daily redemption limit
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const todayRedemptions = await Transaction.aggregate([
    {
      $match: {
        userId: wallet.userId,
        type: 'redeem',
        createdAt: { $gte: today }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  const todayTotal = todayRedemptions.length > 0 ? todayRedemptions[0].total : 0;

  if (todayTotal + amount > config.limits.maxRedeemPerDay) {
    throw new Error(`Daily redemption limit exceeded. Already redeemed ${todayTotal} GPC today.`);
  }

  // Create transaction
  const transaction = new Transaction({
    userId,
    walletAddress: wallet.address,
    amount,
    purchaseAmount: 0,
    type: 'redeem',
    status: 'completed',
    description: description || `Redeemed ${amount} GPC`
  });

  await transaction.save();

  // Update wallet
  wallet.balance -= amount;
  wallet.totalRedeemed += amount;
  wallet.lastTransactionAt = new Date();
  await wallet.save();

  // Calculate dollar value
  const coinValue = await calculateCoinValue();
  const dollarValue = amount * coinValue;

  return { transaction, wallet, dollarValue, coinValue };
}

// Get transaction history
export async function getTransactions(userId, limit = 20, type = null) {
  const query = { userId };

  if (type) {
    query.type = type;
  }

  return await Transaction.find(query)
    .populate('locationId', 'name type')
    .sort({ createdAt: -1 })
    .limit(limit);
}

// Get wallet balance
export async function getBalance(userId) {
  const wallet = await getWallet(userId);
  const coinValue = await calculateCoinValue();
  const dollarValue = wallet.balance * coinValue;

  return {
    wallet,
    coinValue,
    dollarValue
  };
}

// ============ QR CODE MANAGEMENT ============

// Generate QR code data for scanning
export async function generateQRCode(purchaseAmount, locationId = null) {
  const qrData = {
    id: crypto.randomBytes(16).toString('hex'),
    amount: purchaseAmount,
    locationId,
    timestamp: Date.now(),
    expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
  };

  // In production, you'd encrypt this or store it temporarily
  const qrString = JSON.stringify(qrData);
  const qrCode = Buffer.from(qrString).toString('base64');

  return { qrCode, qrData };
}

// Process QR code scan
export async function processQRScan(userId, qrCode) {
  try {
    // Decode QR data
    const qrString = Buffer.from(qrCode, 'base64').toString('utf-8');
    const qrData = JSON.parse(qrString);

    // Validate expiration
    if (qrData.expiresAt && Date.now() > qrData.expiresAt) {
      throw new Error("QR code has expired");
    }

    // Check if already used (prevent double scanning)
    const existingTransaction = await Transaction.findOne({ qrCode });
    if (existingTransaction) {
      throw new Error("QR code has already been used");
    }

    // Send coins
    const result = await sendCoins(userId, qrData.amount, qrData.locationId, qrCode);

    return result;
  } catch (error) {
    throw new Error(`Invalid QR code: ${error.message}`);
  }
}

// ============ STATISTICS ============

// Get overall stats
export async function getStats() {
  const config = await getConfig();
  const totalWallets = await Wallet.countDocuments({ isActive: true });
  const totalTransactions = await Transaction.countDocuments();

  const recentTransactions = await Transaction.find()
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const topWallets = await Wallet.find({ isActive: true })
    .sort({ balance: -1 })
    .limit(10)
    .lean();

  const coinValue = await calculateCoinValue();

  return {
    config,
    totalWallets,
    totalTransactions,
    recentTransactions,
    topWallets,
    coinValue,
    circulatingValue: config.currentSupply * coinValue
  };
}

// Get user stats
export async function getUserStats(userId) {
  const wallet = await getWallet(userId);
  const transactions = await getTransactions(userId, 10);
  const coinValue = await calculateCoinValue();

  // Calculate earnings by month
  const monthlyEarnings = await Transaction.aggregate([
    {
      $match: {
        userId: wallet.userId,
        type: 'earn'
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' }
        },
        total: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    },
    {
      $sort: { '_id.year': -1, '_id.month': -1 }
    },
    {
      $limit: 12
    }
  ]);

  return {
    wallet,
    transactions,
    coinValue,
    dollarValue: wallet.balance * coinValue,
    monthlyEarnings
  };
}

// Admin: Manual coin bonus
export async function grantBonus(userId, amount, description) {
  const config = await getConfig();

  if (config.currentSupply + amount > config.maxSupply) {
    throw new Error("Would exceed maximum supply");
  }

  const wallet = await getWallet(userId);

  const transaction = new Transaction({
    userId,
    walletAddress: wallet.address,
    amount,
    purchaseAmount: 0,
    type: 'bonus',
    status: 'completed',
    description: description || `Admin bonus: ${amount} GPC`
  });

  await transaction.save();

  wallet.balance += amount;
  wallet.totalEarned += amount;
  wallet.lastTransactionAt = new Date();
  await wallet.save();

  config.currentSupply += amount;
  await config.save();

  return { transaction, wallet };
}
