import express from 'express';
const router = express.Router();
import ApiKey from '../../api/v1/models/trader/ApiKey.js';
import Trade from '../../api/v1/models/trader/Trade.js';
import Strategy from '../../api/v1/models/trader/Strategy.js';

// Middleware to ensure user is authenticated (adjust based on your auth)
function requireAuth(req, res, next) {
  if (!req.user) {
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
    const { name, exchange, apiKey, apiSecret } = req.body;

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

// Get trade history
router.get('/trades', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id.toString();
    const { limit = 50, skip = 0 } = req.query;

    const tradeModel = new Trade();
    const trades = await tradeModel.getAll(
      { userId },
      { limit: parseInt(limit), skip: parseInt(skip), sort: { createdAt: -1 } }
    );

    res.json({ success: true, data: trades });
  } catch (error) {
    console.error('Get trades error:', error);
    res.status(500).json({ error: 'Failed to get trades' });
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

// ===== ANALYTICS =====

// Get portfolio summary
router.get('/portfolio', requireAuth, async (_req, res) => {
  try {
    // TODO: Implement portfolio calculation from trades
    // const userId = _req.user._id.toString();
    res.json({
      success: true,
      message: 'Implement portfolio calculation',
      data: {
        totalValue: 0,
        totalInvested: 0,
        profitLoss: 0,
        profitLossPercent: 0,
        holdings: []
      }
    });
  } catch (error) {
    console.error('Get portfolio error:', error);
    res.status(500).json({ error: 'Failed to get portfolio' });
  }
});

export default router;
