
import express from "express";
import {
  getConfig,
  updateConfig,
  calculateCoinValue,
  getWallet,
  getWalletByAddress,
  linkExternalWallet,
  sendCoins,
  redeemCoins,
  getTransactions,
  getBalance,
  generateQRCode,
  processQRScan,
  getStats,
  getUserStats,
  grantBonus
} from "../../api/v1/ep/gpc.js";

const router = express.Router();

// Middleware: require authenticated user
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized. Please log in." });
  }
  next();
}

// Middleware: require admin
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAustins) {
    return res.status(403).json({ error: "Forbidden. Admin access required." });
  }
  next();
}

// ============ VIEW ROUTES ============

// Main GPC page - wallet and QR scanner
router.get("/", async (req, res) => {
  try {
    const user = req.user || null;
    let wallet = null;
    let balance = null;
    let transactions = [];
    let coinValue = 0;

    if (user) {
      wallet = await getWallet(user._id);
      balance = await getBalance(user._id);
      transactions = await getTransactions(user._id, 10);
      coinValue = await calculateCoinValue();
    }

    const config = await getConfig();

    res.render("gpc/index", {
      user,
      wallet,
      balance,
      transactions,
      config,
      coinValue,
      title: "Graffiti Pasta Coin"
    });
  } catch (error) {
    console.error("Error loading GPC page:", error);
    res.status(500).send("Error loading page");
  }
});

// Wallet page
router.get("/wallet", requireAuth, async (req, res) => {
  try {
    const balance = await getBalance(req.user._id);
    const stats = await getUserStats(req.user._id);

    res.render("gpc/wallet", {
      user: req.user,
      balance,
      stats,
      title: "My Wallet - GPC"
    });
  } catch (error) {
    console.error("Error loading wallet:", error);
    res.status(500).send("Error loading wallet");
  }
});

// Admin dashboard
router.get("/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await getStats();

    res.render("gpc/admin", {
      user: req.user,
      stats,
      title: "GPC Admin Dashboard"
    });
  } catch (error) {
    console.error("Error loading admin dashboard:", error);
    res.status(500).send("Error loading dashboard");
  }
});

// QR Scanner page
router.get("/scan", requireAuth, async (req, res) => {
  try {
    const balance = await getBalance(req.user._id);

    res.render("gpc/scan", {
      user: req.user,
      balance,
      title: "Scan QR Code - GPC"
    });
  } catch (error) {
    console.error("Error loading scanner:", error);
    res.status(500).send("Error loading scanner");
  }
});

// Generate QR code page (for cashier/POS)
router.get("/generate", requireAuth, async (req, res) => {
  try {
    res.render("gpc/generate", {
      user: req.user,
      title: "Generate QR Code - GPC"
    });
  } catch (error) {
    console.error("Error loading generator:", error);
    res.status(500).send("Error loading generator");
  }
});

// ============ API ROUTES ============

// Get config
router.get("/api/config", async (req, res) => {
  try {
    const config = await getConfig();
    const coinValue = await calculateCoinValue();
    res.json({ config, coinValue });
  } catch (error) {
    console.error("Error fetching config:", error);
    res.status(500).json({ error: "Error fetching config" });
  }
});

// Update config (admin only)
router.put("/api/config", requireAuth, requireAdmin, async (req, res) => {
  try {
    const config = await updateConfig(req.body);
    res.json(config);
  } catch (error) {
    console.error("Error updating config:", error);
    res.status(500).json({ error: "Error updating config" });
  }
});

// Get wallet
router.get("/api/wallet", requireAuth, async (req, res) => {
  try {
    const wallet = await getWallet(req.user._id);
    res.json(wallet);
  } catch (error) {
    console.error("Error fetching wallet:", error);
    res.status(500).json({ error: "Error fetching wallet" });
  }
});

// Get balance
router.get("/api/balance", requireAuth, async (req, res) => {
  try {
    const balance = await getBalance(req.user._id);
    res.json(balance);
  } catch (error) {
    console.error("Error fetching balance:", error);
    res.status(500).json({ error: "Error fetching balance" });
  }
});

// Link external wallet
router.post("/api/wallet/link", requireAuth, async (req, res) => {
  try {
    const { externalAddress } = req.body;

    if (!externalAddress) {
      return res.status(400).json({ error: "External address required" });
    }

    const wallet = await linkExternalWallet(req.user._id, externalAddress);
    res.json({
      success: true,
      wallet,
      message: "External wallet linked successfully"
    });
  } catch (error) {
    console.error("Error linking wallet:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get transactions
router.get("/api/transactions", requireAuth, async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const type = req.query.type || null;
    const transactions = await getTransactions(req.user._id, limit, type);
    res.json(transactions);
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res.status(500).json({ error: "Error fetching transactions" });
  }
});

// Generate QR code (for cashier)
router.post("/api/qr/generate", requireAuth, async (req, res) => {
  try {
    const { purchaseAmount, locationId } = req.body;

    if (!purchaseAmount || purchaseAmount <= 0) {
      return res.status(400).json({ error: "Valid purchase amount required" });
    }

    const { qrCode, qrData } = await generateQRCode(
      parseFloat(purchaseAmount),
      locationId || null
    );

    res.json({
      success: true,
      qrCode,
      qrData,
      message: "QR code generated successfully"
    });
  } catch (error) {
    console.error("Error generating QR code:", error);
    res.status(500).json({ error: error.message });
  }
});

// Process QR scan (customer scans to receive coins)
router.post("/api/qr/scan", requireAuth, async (req, res) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode) {
      return res.status(400).json({ error: "QR code required" });
    }

    const result = await processQRScan(req.user._id, qrCode);

    res.json({
      success: true,
      ...result,
      message: `You received ${result.transaction.amount} GPC from $${result.transaction.purchaseAmount.toFixed(2)} purchase!`
    });
  } catch (error) {
    console.error("Error processing QR scan:", error);
    res.status(400).json({ error: error.message });
  }
});

// Send coins manually (admin)
router.post("/api/send", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, purchaseAmount, locationId } = req.body;

    if (!userId || !purchaseAmount) {
      return res.status(400).json({ error: "User ID and purchase amount required" });
    }

    const result = await sendCoins(userId, parseFloat(purchaseAmount), locationId);

    res.json({
      success: true,
      ...result,
      message: "Coins sent successfully"
    });
  } catch (error) {
    console.error("Error sending coins:", error);
    res.status(400).json({ error: error.message });
  }
});

// Redeem coins
router.post("/api/redeem", requireAuth, async (req, res) => {
  try {
    const { amount, description } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Valid amount required" });
    }

    const result = await redeemCoins(req.user._id, parseFloat(amount), description);

    res.json({
      success: true,
      ...result,
      message: `Redeemed ${amount} GPC (worth $${result.dollarValue.toFixed(2)})`
    });
  } catch (error) {
    console.error("Error redeeming coins:", error);
    res.status(400).json({ error: error.message });
  }
});

// Get user stats
router.get("/api/stats", requireAuth, async (req, res) => {
  try {
    const stats = await getUserStats(req.user._id);
    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Error fetching stats" });
  }
});

// Get overall stats (admin)
router.get("/api/stats/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Error fetching stats" });
  }
});

// Grant bonus (admin)
router.post("/api/bonus", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId, amount, description } = req.body;

    if (!userId || !amount || amount <= 0) {
      return res.status(400).json({ error: "User ID and valid amount required" });
    }

    const result = await grantBonus(userId, parseFloat(amount), description);

    res.json({
      success: true,
      ...result,
      message: `Granted ${amount} GPC bonus`
    });
  } catch (error) {
    console.error("Error granting bonus:", error);
    res.status(400).json({ error: error.message });
  }
});

export default router;