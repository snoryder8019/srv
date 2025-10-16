import { connectDB } from '../plugins/mongo/db.js';
import Strategy from '../api/v1/models/trader/Strategy.js';
import ApiKey from '../api/v1/models/trader/ApiKey.js';
import Trade from '../api/v1/models/trader/Trade.js';

// Connect to database
await connectDB();

console.log('🤖 Strategy Monitor Started');
console.log('⏰ Checking for active strategies every 10 seconds...\n');

// Store active intervals for each strategy
const activeMonitors = new Map();

// Main monitoring loop
async function checkStrategies() {
  try {
    const strategyModel = new Strategy();
    const strategies = await strategyModel.getAll({ isRunning: true, isActive: true });

    console.log(`[${new Date().toLocaleTimeString()}] Found ${strategies.length} running strategies`);

    for (const strategy of strategies) {
      // Check if this strategy already has a monitor
      if (activeMonitors.has(strategy._id)) {
        continue; // Skip if already monitoring
      }

      // Start monitoring this strategy
      console.log(`✅ Starting monitor for: ${strategy.name} (${strategy.pair})`);
      startStrategyMonitor(strategy);
    }

    // Clean up monitors for stopped strategies
    for (const [strategyId, interval] of activeMonitors.entries()) {
      const stillRunning = strategies.find(s => s._id === strategyId);
      if (!stillRunning) {
        console.log(`⏹ Stopping monitor for strategy: ${strategyId}`);
        clearInterval(interval);
        activeMonitors.delete(strategyId);
      }
    }

  } catch (error) {
    console.error('❌ Error checking strategies:', error.message);
  }
}

// Start monitoring a specific strategy
function startStrategyMonitor(strategy) {
  const checkInterval = (strategy.checkInterval || 60) * 1000; // Convert to milliseconds

  const intervalId = setInterval(async () => {
    try {
      await executeStrategy(strategy);
    } catch (error) {
      console.error(`❌ Error executing strategy ${strategy.name}:`, error.message);
    }
  }, checkInterval);

  activeMonitors.set(strategy._id, intervalId);
}

// Execute strategy logic
async function executeStrategy(strategy) {
  console.log(`\n🔄 [${new Date().toLocaleTimeString()}] Executing: ${strategy.name}`);

  const strategyModel = new Strategy();
  const tradeModel = new Trade();
  const apiKeyModel = new ApiKey();

  // Get API key
  let apiKey;
  if (strategy.apiKeyId) {
    apiKey = await apiKeyModel.getById(strategy.apiKeyId);
  } else {
    // Get first active API key for this user
    const keys = await apiKeyModel.getAll({ userId: strategy.userId, isActive: true });
    apiKey = keys[0];
  }

  if (!apiKey) {
    console.log(`⚠️  No API key configured for strategy: ${strategy.name}`);
    return;
  }

  // Fetch current market price
  const currentPrice = await fetchCurrentPrice(strategy.pair);
  if (!currentPrice) {
    console.log(`⚠️  Could not fetch price for ${strategy.pair}`);
    return;
  }

  console.log(`   Current ${strategy.pair} price: $${currentPrice.toFixed(2)}`);

  // Check buy conditions
  const buyConditions = strategy.buyConditions || {};
  let shouldBuy = false;
  let buyReason = '';

  if (buyConditions.priceBelow && currentPrice < buyConditions.priceBelow) {
    shouldBuy = true;
    buyReason = `Price dropped below $${buyConditions.priceBelow}`;
  } else if (buyConditions.priceAbove && currentPrice > buyConditions.priceAbove) {
    shouldBuy = true;
    buyReason = `Price rose above $${buyConditions.priceAbove}`;
  }

  // Check sell conditions
  const sellConditions = strategy.sellConditions || {};
  let shouldSell = false;
  let sellReason = '';

  if (sellConditions.priceAbove && currentPrice > sellConditions.priceAbove) {
    shouldSell = true;
    sellReason = `Price rose above $${sellConditions.priceAbove}`;
  } else if (sellConditions.priceBelow && currentPrice < sellConditions.priceBelow) {
    shouldSell = true;
    sellReason = `Price dropped below $${sellConditions.priceBelow}`;
  }

  // Check if we've hit max trades
  const activeTrades = await tradeModel.getAll({
    userId: strategy.userId,
    status: 'pending',
    notes: { $regex: `Strategy: ${strategy.name}` }
  });

  const canTrade = activeTrades.length < (strategy.maxTrades || 10);

  // Execute buy
  if (shouldBuy && canTrade) {
    console.log(`   🟢 BUY Signal: ${buyReason}`);

    const tradeAmount = strategy.tradeAmount || 10;
    const cryptoAmount = tradeAmount / currentPrice;

    const trade = await tradeModel.create({
      userId: strategy.userId,
      exchange: apiKey.exchange,
      pair: strategy.pair,
      side: 'buy',
      amount: cryptoAmount,
      price: currentPrice,
      total: tradeAmount,
      status: 'completed', // For now, mark as completed
      notes: `Strategy: ${strategy.name} - ${buyReason}`,
      executedAt: new Date(),
      createdAt: new Date()
    });

    // Update strategy stats
    await strategyModel.updateById(strategy._id, {
      lastRun: new Date(),
      totalRuns: (strategy.totalRuns || 0) + 1,
      successfulTrades: (strategy.successfulTrades || 0) + 1
    });

    console.log(`   ✅ BUY order created: ${cryptoAmount.toFixed(8)} ${strategy.pair.split('-')[0]}`);
  }

  // Execute sell
  if (shouldSell && activeTrades.length > 0) {
    console.log(`   🔴 SELL Signal: ${sellReason}`);

    // Sell the oldest trade
    const oldestTrade = activeTrades[0];
    const sellAmount = oldestTrade.amount;

    const trade = await tradeModel.create({
      userId: strategy.userId,
      exchange: apiKey.exchange,
      pair: strategy.pair,
      side: 'sell',
      amount: sellAmount,
      price: currentPrice,
      total: sellAmount * currentPrice,
      status: 'completed',
      notes: `Strategy: ${strategy.name} - ${sellReason}`,
      executedAt: new Date(),
      createdAt: new Date()
    });

    // Update strategy stats
    await strategyModel.updateById(strategy._id, {
      lastRun: new Date(),
      totalRuns: (strategy.totalRuns || 0) + 1,
      successfulTrades: (strategy.successfulTrades || 0) + 1
    });

    console.log(`   ✅ SELL order created: ${sellAmount.toFixed(8)} ${strategy.pair.split('-')[0]}`);
  }

  if (!shouldBuy && !shouldSell) {
    console.log(`   ⏸️  No action - Conditions not met`);
  }

  if (shouldBuy && !canTrade) {
    console.log(`   ⚠️  BUY signal but max trades reached (${activeTrades.length}/${strategy.maxTrades})`);
  }
}

// Fetch current price from Coinbase
async function fetchCurrentPrice(pair) {
  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/ticker`);
    if (!response.ok) return null;

    const data = await response.json();
    return parseFloat(data.price);
  } catch (error) {
    console.error(`Error fetching price for ${pair}:`, error.message);
    return null;
  }
}

// Check strategies every 10 seconds
setInterval(checkStrategies, 10000);

// Initial check
checkStrategies();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down strategy monitor...');

  // Clear all intervals
  for (const [strategyId, interval] of activeMonitors.entries()) {
    clearInterval(interval);
  }

  process.exit(0);
});
