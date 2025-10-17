import express from 'express';
const router = express.Router();
import ApiKey from '../../api/v1/models/trader/ApiKey.js';
import Trade from '../../api/v1/models/trader/Trade.js';
import Strategy from '../../api/v1/models/trader/Strategy.js';
import crypto from 'crypto';

// Middleware to ensure user is authenticated (adjust based on your auth)
function requireAuth(req, res, next) {
  if (!req.user.isAdmin
    
  ) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// ===== DASHBOARD =====
router.get('/', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const userId = user._id.toString();

    // Get user's API keys
    const apiKeyModel = new ApiKey();
    const apiKeys = await apiKeyModel.getAll({ userId });

    // Get recent trades
    const tradeModel = new Trade();
    const trades = await tradeModel.getAll({ userId }, { limit: 20, sort: { createdAt: -1 } });

    // Get strategies
    const strategyModel = new Strategy();
    const strategies = await strategyModel.getAll({ userId });

    res.render('trader/index', {
      user,
      apiKeys,
      trades,
      strategies,
      title: 'Coinbase Trader Bot'
    });
  } catch (error) {
    console.error('Trader dashboard error:', error);
    res.status(500).send('Internal Server Error');
  }
});

// ===== API KEYS MANAGEMENT =====

// Get all API keys for current user
router.get('/api-keys', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const apiKeyModel = new ApiKey();
    const keys = await apiKeyModel.getAll({ userId });

    // Hide secret keys in response
    const safeKeys = keys.map(key => ({
      ...key,
      apiSecret: key.apiSecret ? '***********' : null
    }));

    res.json({ success: true, data: safeKeys });
  } catch (error) {
    console.error('Get API keys error:', error);
    res.status(500).json({ error: 'Failed to retrieve API keys' });
  }
});

// Add new API key
router.post('/api-keys', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { name, exchange, apiKey, apiSecret, apiPassphrase } = req.body;

    if (!name || !exchange || !apiKey || !apiSecret) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const apiKeyModel = new ApiKey();
    const newKey = await apiKeyModel.create({
      userId,
      name,
      exchange,
      apiKey,
      apiSecret, // TODO: Encrypt this before storing
      apiPassphrase: apiPassphrase || '', // Optional passphrase
      isActive: true,
      createdAt: new Date()
    });

    res.json({ success: true, data: newKey });
  } catch (error) {
    console.error('Add API key error:', error);
    res.status(500).json({ error: 'Failed to add API key' });
  }
});

// Update API key
router.put('/api-keys/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const apiKeyModel = new ApiKey();
    const existing = await apiKeyModel.getById(id);

    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await apiKeyModel.updateById(id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Update API key error:', error);
    res.status(500).json({ error: 'Failed to update API key' });
  }
});

// Delete API key
router.delete('/api-keys/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const apiKeyModel = new ApiKey();
    const existing = await apiKeyModel.getById(id);

    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'API key not found' });
    }

    await apiKeyModel.deleteById(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete API key error:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Test API key connection
router.post('/api-keys/:id/test', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const apiKeyModel = new ApiKey();
    const keyData = await apiKeyModel.getById(id);

    if (!keyData || keyData.userId !== userId) {
      return res.status(404).json({ error: 'API key not found' });
    }

    // TODO: Implement actual Coinbase API connection test
    // For now, just return a placeholder
    res.json({
      success: true,
      message: 'API key test endpoint - implement Coinbase SDK connection',
      exchange: keyData.exchange
    });
  } catch (error) {
    console.error('Test API key error:', error);
    res.status(500).json({ error: 'Failed to test API key' });
  }
});

// ===== TRADING =====

// Get ticker data (top 5 coins + active trades)
router.get('/ticker', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // Get active/pending trades for this user
    const tradeModel = new Trade();
    const activeTrades = await tradeModel.getAll(
      { userId, status: { $in: ['pending', 'completed'] } },
      { limit: 5, sort: { createdAt: -1 } }
    );

    // Fetch real price data from Coinbase API (free, no API key required)
    let topCoins = [];
    try {
      const pairs = [
        { id: 'BTC-USD', symbol: 'BTC', name: 'Bitcoin' },
        { id: 'ETH-USD', symbol: 'ETH', name: 'Ethereum' },
        { id: 'SOL-USD', symbol: 'SOL', name: 'Solana' },
        { id: 'BNB-USD', symbol: 'BNB', name: 'BNB' },
        { id: 'XRP-USD', symbol: 'XRP', name: 'XRP' }
      ];

      // Fetch data for each pair from Coinbase
      const pricePromises = pairs.map(async (pair) => {
        try {
          // Get current price and 24h stats
          const [tickerRes, statsRes] = await Promise.all([
            fetch(`https://api.exchange.coinbase.com/products/${pair.id}/ticker`),
            fetch(`https://api.exchange.coinbase.com/products/${pair.id}/stats`)
          ]);

          if (tickerRes.ok && statsRes.ok) {
            const ticker = await tickerRes.json();
            const stats = await statsRes.json();

            const currentPrice = parseFloat(ticker.price) || 0;
            const open24h = parseFloat(stats.open) || currentPrice;
            const change24h = open24h > 0 ? ((currentPrice - open24h) / open24h) * 100 : 0;
            const volume = parseFloat(stats.volume) || 0;

            return {
              symbol: pair.symbol,
              name: pair.name,
              price: currentPrice,
              change24h: change24h,
              volume: volume
            };
          }
          return null;
        } catch (err) {
          console.error(`Error fetching ${pair.id}:`, err.message);
          return null;
        }
      });

      const results = await Promise.all(pricePromises);
      topCoins = results.filter(coin => coin !== null);

    } catch (apiError) {
      console.error('Failed to fetch Coinbase data:', apiError);
      // Fallback to empty array if fetch fails
      topCoins = [];
    }

    res.json({
      success: true,
      data: {
        topCoins,
        activeTrades: activeTrades.map(t => ({
          pair: t.pair,
          side: t.side,
          amount: t.amount,
          status: t.status,
          price: t.price
        }))
      }
    });
  } catch (error) {
    console.error('Get ticker error:', error);
    res.status(500).json({ error: 'Failed to get ticker data' });
  }
});

// Get market data (placeholder for Coinbase integration)
router.get('/market/:pair', requireAuth, async (req, res) => {
  try {
    const { pair } = req.params;

    // TODO: Implement Coinbase API integration to get real market data
    res.json({
      success: true,
      pair,
      message: 'Implement Coinbase market data API',
      data: {
        price: 0,
        volume: 0,
        high24h: 0,
        low24h: 0
      }
    });
  } catch (error) {
    console.error('Get market data error:', error);
    res.status(500).json({ error: 'Failed to get market data' });
  }
});

// Place a trade
router.post('/trade', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { apiKeyId, pair, side, amount, price } = req.body;

    if (!apiKeyId || !pair || !side || !amount) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify API key belongs to user
    const apiKeyModel = new ApiKey();
    const keyData = await apiKeyModel.getById(apiKeyId);

    if (!keyData || keyData.userId !== userId || !keyData.isActive) {
      return res.status(403).json({ error: 'Invalid or inactive API key' });
    }

    // TODO: Implement actual Coinbase trade execution
    // For now, create a pending trade record
    const tradeModel = new Trade();
    const trade = await tradeModel.create({
      userId,
      exchange: keyData.exchange,
      pair,
      side,
      amount,
      price: price || 0,
      total: (price || 0) * amount,
      status: 'pending',
      notes: 'Manual trade',
      createdAt: new Date()
    });

    res.json({
      success: true,
      message: 'Trade created (implement Coinbase SDK for execution)',
      data: trade
    });
  } catch (error) {
    console.error('Trade error:', error);
    res.status(500).json({ error: 'Failed to execute trade' });
  }
});

// Get trade alerts (status changes and profit/loss warnings)
router.get('/trade-alerts', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const tradeModel = new Trade();

    // Get all active trades (pending, completed in last 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const trades = await tradeModel.getAll(
      {
        userId,
        $or: [
          { status: 'pending' },
          { status: 'completed', executedAt: { $gte: fiveMinutesAgo } },
          { status: 'failed', createdAt: { $gte: fiveMinutesAgo } }
        ]
      },
      { sort: { createdAt: -1 } }
    );

    // Get strategies for profit/loss thresholds
    const strategyModel = new Strategy();
    const strategies = await strategyModel.getAll({ userId });

    // Build profit alerts array
    const profitAlerts = [];

    // For each trade, check if it's near profit target or stop loss
    for (const trade of trades) {
      if (trade.status === 'pending' || trade.status === 'completed') {
        // Find matching strategy for this trade
        const matchingStrategy = strategies.find(s =>
          trade.notes && trade.notes.includes(s.name)
        );

        if (matchingStrategy && trade.price > 0) {
          // Get current market price (simplified - in real implementation, fetch from API)
          // For now, we'll use a mock current price
          const mockCurrentPrices = {
            'BTC-USD': 67500,
            'ETH-USD': 3400,
            'SOL-USD': 140,
            'BNB-USD': 590,
            'XRP-USD': 0.51
          };

          const currentPrice = mockCurrentPrices[trade.pair] || trade.price;
          const entryPrice = trade.price;

          // Calculate profit percentage
          let profitPercent = 0;
          if (trade.side === 'buy') {
            profitPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
          } else {
            profitPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
          }

          // Check if near take profit (within 10% of target)
          if (matchingStrategy.takeProfit) {
            const targetDistance = Math.abs(profitPercent - matchingStrategy.takeProfit);
            if (targetDistance < matchingStrategy.takeProfit * 0.1 && profitPercent > 0) {
              profitAlerts.push({
                tradeId: trade._id,
                pair: trade.pair,
                type: 'profit_target',
                targetPercent: matchingStrategy.takeProfit,
                currentProfitPercent: profitPercent,
                currentPrice
              });
            }
          }

          // Check if near stop loss (within 10% of stop)
          if (matchingStrategy.stopLoss) {
            const stopDistance = Math.abs(Math.abs(profitPercent) - matchingStrategy.stopLoss);
            if (stopDistance < matchingStrategy.stopLoss * 0.1 && profitPercent < 0) {
              profitAlerts.push({
                tradeId: trade._id,
                pair: trade.pair,
                type: 'stop_loss',
                stopLossPercent: matchingStrategy.stopLoss,
                currentProfitPercent: profitPercent,
                currentPrice
              });
            }
          }
        }
      }
    }

    res.json({
      success: true,
      data: {
        statusChanges: trades.map(t => ({
          _id: t._id,
          pair: t.pair,
          side: t.side,
          amount: t.amount,
          price: t.price,
          status: t.status,
          notes: t.notes
        })),
        profitAlerts
      }
    });
  } catch (error) {
    console.error('Get trade alerts error:', error);
    res.status(500).json({ error: 'Failed to get trade alerts' });
  }
});

// Get trade history
router.get('/trades', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { limit = 50, skip = 0, status } = req.query;

    const tradeModel = new Trade();
    const filter = { userId };

    // Filter by status if provided
    if (status) {
      filter.status = status;
    }

    const trades = await tradeModel.getAll(
      filter,
      { limit: parseInt(limit), skip: parseInt(skip), sort: { createdAt: -1 } }
    );

    res.json({ success: true, data: trades });
  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({ error: 'Failed to get trades' });
  }
});

// Get pending trades
router.get('/trades/pending', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    const tradeModel = new Trade();
    const pendingTrades = await tradeModel.getAll(
      { userId, status: 'pending' },
      { sort: { createdAt: -1 } }
    );

    res.json({ success: true, data: pendingTrades });
  } catch (error) {
    console.error('Get pending trades error:', error);
    res.status(500).json({ error: 'Failed to get pending trades' });
  }
});

// Cancel a pending trade
router.post('/trades/:id/cancel', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const tradeModel = new Trade();
    const trade = await tradeModel.getById(id);

    if (!trade || trade.userId !== userId) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    if (trade.status !== 'pending') {
      return res.status(400).json({
        error: 'Can only cancel pending trades',
        currentStatus: trade.status
      });
    }

    // TODO: If this trade has an orderId on the exchange, cancel it there too
    // For now, just update the status in our database
    await tradeModel.updateById(id, {
      status: 'cancelled',
      notes: (trade.notes || '') + ' [Cancelled by user]'
    });

    res.json({
      success: true,
      message: 'Trade cancelled successfully',
      tradeId: id
    });
  } catch (error) {
    console.error('Cancel trade error:', error);
    res.status(500).json({ error: 'Failed to cancel trade' });
  }
});

// ===== STRATEGIES =====

// Get all strategies
router.get('/strategies', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const strategyModel = new Strategy();
    const strategies = await strategyModel.getAll({ userId });

    res.json({ success: true, data: strategies });
  } catch (error) {
    console.error('Get strategies error:', error);
    res.status(500).json({ error: 'Failed to get strategies' });
  }
});

// Get strategy details by ID
router.get('/strategies/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const strategyModel = new Strategy();
    const strategy = await strategyModel.getById(id);

    if (!strategy || strategy.userId !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Get associated trades for this strategy
    const tradeModel = new Trade();
    const trades = await tradeModel.getAll(
      { userId, notes: { $regex: `Strategy: ${strategy.name}` } },
      { limit: 10, sort: { createdAt: -1 } }
    );

    res.json({
      success: true,
      data: {
        ...strategy,
        recentTrades: trades
      }
    });
  } catch (error) {
    console.error('Get strategy details error:', error);
    res.status(500).json({ error: 'Failed to get strategy details' });
  }
});

// Create strategy
router.post('/strategies', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const strategyModel = new Strategy();

    const strategy = await strategyModel.create({
      ...req.body,
      userId,
      isActive: false,
      createdAt: new Date()
    });

    res.json({ success: true, data: strategy });
  } catch (error) {
    console.error('Create strategy error:', error);
    res.status(500).json({ error: 'Failed to create strategy' });
  }
});

// Update strategy
router.put('/strategies/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const strategyModel = new Strategy();
    const existing = await strategyModel.getById(id);

    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    await strategyModel.updateById(id, req.body);
    res.json({ success: true });
  } catch (error) {
    console.error('Update strategy error:', error);
    res.status(500).json({ error: 'Failed to update strategy' });
  }
});

// Delete strategy
router.delete('/strategies/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const strategyModel = new Strategy();
    const existing = await strategyModel.getById(id);

    if (!existing || existing.userId !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    await strategyModel.deleteById(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete strategy error:', error);
    res.status(500).json({ error: 'Failed to delete strategy' });
  }
});

// Toggle strategy active status
router.post('/strategies/:id/toggle', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const strategyModel = new Strategy();
    const strategy = await strategyModel.getById(id);

    if (!strategy || strategy.userId !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    await strategyModel.updateById(id, { isActive: !strategy.isActive });
    res.json({ success: true, isActive: !strategy.isActive });
  } catch (error) {
    console.error('Toggle strategy error:', error);
    res.status(500).json({ error: 'Failed to toggle strategy' });
  }
});

// Start strategy monitor
router.post('/strategies/:id/start-monitor', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const strategyModel = new Strategy();
    const strategy = await strategyModel.getById(id);

    if (!strategy || strategy.userId !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    if (strategy.isRunning) {
      return res.status(400).json({ error: 'Strategy monitor already running' });
    }

    // Mark strategy as running
    await strategyModel.updateById(id, { isRunning: true, isActive: true });

    // TODO: Start background monitor process
    // This will be handled by the strategy-monitor.js script

    res.json({ success: true, message: 'Strategy monitor started' });
  } catch (error) {
    console.error('Start monitor error:', error);
    res.status(500).json({ error: 'Failed to start monitor' });
  }
});

// Stop strategy monitor
router.post('/strategies/:id/stop-monitor', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;

    const strategyModel = new Strategy();
    const strategy = await strategyModel.getById(id);

    if (!strategy || strategy.userId !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Mark strategy as stopped
    await strategyModel.updateById(id, { isRunning: false });

    res.json({ success: true, message: 'Strategy monitor stopped' });
  } catch (error) {
    console.error('Stop monitor error:', error);
    res.status(500).json({ error: 'Failed to stop monitor' });
  }
});

// Execute strategy manually (dry run or actual execution)
router.post('/strategies/:id/execute', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { id } = req.params;
    const { dryRun = false, apiKeyId } = req.body;

    const strategyModel = new Strategy();
    const strategy = await strategyModel.getById(id);

    if (!strategy || strategy.userId !== userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }

    // Verify API key if not a dry run
    let keyData = null;
    if (!dryRun) {
      if (!apiKeyId) {
        return res.status(400).json({ error: 'API key ID required for actual execution' });
      }

      const apiKeyModel = new ApiKey();
      keyData = await apiKeyModel.getById(apiKeyId);

      if (!keyData || keyData.userId !== userId || !keyData.isActive) {
        return res.status(403).json({ error: 'Invalid or inactive API key' });
      }
    }

    // Execute strategy based on type
    const result = await executeStrategy(strategy, keyData, dryRun, userId);

    // Update last run time
    await strategyModel.updateById(id, { lastRun: new Date() });

    res.json({
      success: true,
      dryRun,
      data: result
    });
  } catch (error) {
    console.error('Execute strategy error:', error);
    res.status(500).json({ error: 'Failed to execute strategy', details: error.message });
  }
});

// Helper function to execute a strategy
async function executeStrategy(strategy, apiKey, dryRun, userId) {
  const tradeModel = new Trade();

  // This is a basic implementation - you'll need to expand based on your needs
  const result = {
    strategyName: strategy.name,
    strategyType: strategy.strategyType,
    pair: strategy.pair,
    signals: [],
    trades: []
  };

  // Analyze strategy type and execute accordingly
  switch (strategy.strategyType) {
    case 'DCA': // Dollar Cost Averaging
      result.signals.push({
        type: 'buy',
        reason: 'DCA scheduled buy',
        amount: strategy.maxInvestment / 10, // Buy in 10 increments
        confidence: 'scheduled'
      });

      if (!dryRun) {
        const trade = await tradeModel.create({
          userId,
          exchange: apiKey.exchange,
          pair: strategy.pair,
          side: 'buy',
          amount: strategy.maxInvestment / 10,
          price: 0, // Market order
          total: 0,
          status: 'pending',
          notes: `Strategy: ${strategy.name} (DCA)`,
          createdAt: new Date()
        });
        result.trades.push(trade);
      }
      break;

    case 'Grid':
      // TODO: Implement grid trading logic
      result.signals.push({
        type: 'info',
        reason: 'Grid trading requires market data - implement Coinbase API integration',
        confidence: 'n/a'
      });
      break;

    case 'Momentum':
      // TODO: Implement momentum trading logic
      result.signals.push({
        type: 'info',
        reason: 'Momentum trading requires market data - implement Coinbase API integration',
        confidence: 'n/a'
      });
      break;

    case 'Manual':
      // Check buy/sell conditions from the strategy
      if (strategy.buyConditions && Object.keys(strategy.buyConditions).length > 0) {
        result.signals.push({
          type: 'buy',
          reason: 'Manual strategy buy conditions met',
          conditions: strategy.buyConditions,
          confidence: 'manual'
        });
      }
      break;

    default:
      result.signals.push({
        type: 'error',
        reason: `Unknown strategy type: ${strategy.strategyType}`
      });
  }

  return result;
}

// ===== ANALYTICS =====

// Get account balances
// routes/coinbase.js
import jwt from "jsonwebtoken";

function buildRestJWT({ keyName, keySecret, method, host, path }) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: process.env.CB_TRADER,
      sub: process.env.CB_TRADER_SEC,
      iat: now,
      exp: now + 110,
      // Coinbase REST JWTs: include formatted URI
      uri: `${method.toUpperCase()} ${host}${path}`
    },
    keySecret,
    { algorithm: "ES256", header: { kid: keyName } }
  );
}

router.get('/balances', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const apiKeyModel = new ApiKey();
    const apiKeys = await apiKeyModel.getAll({ userId, isActive: true });
    if (!apiKeys?.length) return res.json({ success:true, data:{ balances:[], totalUSD:0 } });

    const { keyName, keySecret } = apiKeys[0]; // store these in your model
    const host = 'api.coinbase.com';
    const acctPath = '/api/v3/brokerage/accounts?limit=250';
    const token = buildRestJWT({ keyName, keySecret, method:'GET', host, path:acctPath });

    // 1) Accounts (balances)
    const acctRes = await fetch(`https://${host}${acctPath}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!acctRes.ok) {
      return res.json({ success:true, data:{ balances:[], totalUSD:0, error:'Coinbase v3 auth failed' } });
    }
    const acctJson = await acctRes.json();
    const accounts = acctJson?.accounts || [];

    // 2) Prices in one shot via best_bid_ask
    const nonUSD = [...new Set(accounts.map(a => a.currency).filter(c => !['USD','USDC','USDT'].includes(c)))];
    let priceMap = {};
    if (nonUSD.length) {
      const q = nonUSD.map(c => `${c}-USD`).join(',');
      const pricePath = `/api/v3/brokerage/best_bid_ask?product_ids=${encodeURIComponent(q)}`;
      const priceJwt = buildRestJWT({ keyName, keySecret, method:'GET', host, path:pricePath });
      const priceRes = await fetch(`https://${host}${pricePath}`, {
        headers: { Authorization: `Bearer ${priceJwt}` }
      });
      if (priceRes.ok) {
        const { pricebooks=[] } = await priceRes.json();
        // use mid = (bid+ask)/2
        for (const p of pricebooks) {
          const bid = parseFloat(p.bids?.[0]?.price || '0');
          const ask = parseFloat(p.asks?.[0]?.price || '0');
          const cur = p.product_id.split('-')[0];
          priceMap[cur] = (bid && ask) ? (bid+ask)/2 : (bid || ask || 0);
        }
      }
    }

    const nameMap = {
      USD:'US Dollar', BTC:'Bitcoin', ETH:'Ethereum', SOL:'Solana', BNB:'BNB',
      XRP:'Ripple', ADA:'Cardano', DOGE:'Dogecoin', MATIC:'Polygon',
      LTC:'Litecoin', USDC:'USD Coin', USDT:'Tether'
    };

    const balances = accounts.map(a => {
      const available = parseFloat(a.available_balance?.value || '0');
      const hold = parseFloat(a.hold?.value || '0');
      const cur = a.currency;
      const usdValue =
        (cur === 'USD' || cur === 'USDC' || cur === 'USDT')
          ? available
          : available * (priceMap[cur] || 0);
      return {
        currency: cur,
        currencyName: nameMap[cur] || cur,
        available,
        hold,
        usdValue
      };
    }).filter(b => b.available > 1e-8);

    const totalUSD = balances.reduce((s,b)=>s+(b.usdValue||0),0);

    res.json({ success:true, data:{ balances, totalUSD } });
  } catch (e) {
    console.error('Get balances error:', e);
    res.status(500).json({ error:'Failed to get balances' });
  }
});


// Get portfolio summary
router.get('/portfolio', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const tradeModel = new Trade();

    // Get all completed trades
    const allTrades = await tradeModel.getAll({ userId });

    // Calculate portfolio stats
    let totalInvested = 0;
    let currentValue = 0;
    const holdings = {};
    let activePositions = 0;

    // Current market prices (mock - should fetch from API)
    const mockCurrentPrices = {
      'BTC-USD': 67500,
      'ETH-USD': 3400,
      'SOL-USD': 140,
      'BNB-USD': 590,
      'XRP-USD': 0.51
    };

    // Process all trades
    allTrades.forEach(trade => {
      if (trade.status === 'completed') {
        const pair = trade.pair;
        const amount = parseFloat(trade.amount) || 0;
        const price = parseFloat(trade.price) || 0;
        const total = parseFloat(trade.total) || (amount * price);

        if (!holdings[pair]) {
          holdings[pair] = {
            pair,
            amount: 0,
            invested: 0,
            currentValue: 0
          };
        }

        if (trade.side === 'buy') {
          holdings[pair].amount += amount;
          holdings[pair].invested += total;
          totalInvested += total;
        } else if (trade.side === 'sell') {
          holdings[pair].amount -= amount;
          holdings[pair].invested -= total;
          totalInvested -= total;
        }
      }
    });

    // Calculate current value for each holding
    Object.keys(holdings).forEach(pair => {
      const holding = holdings[pair];
      if (holding.amount > 0) {
        const currentPrice = mockCurrentPrices[pair] || 0;
        holding.currentValue = holding.amount * currentPrice;
        currentValue += holding.currentValue;
        activePositions++;
      }
    });

    // Calculate profit/loss
    const profitLoss = currentValue - totalInvested;
    const profitLossPercent = totalInvested > 0 ? (profitLoss / totalInvested) * 100 : 0;

    // Filter out empty holdings
    const activeHoldings = Object.values(holdings).filter(h => h.amount > 0);

    res.json({
      success: true,
      data: {
        totalInvested,
        currentValue,
        profitLoss,
        profitLossPercent,
        activePositions,
        totalTrades: allTrades.length,
        holdings: activeHoldings
      }
    });
  } catch (error) {
    console.error('Get portfolio error:', error);
    res.status(500).json({ error: 'Failed to get portfolio' });
  }
});

export default router;
