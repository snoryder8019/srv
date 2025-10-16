#!/usr/bin/env node

/**
 * Automated Trading Bot Monitor
 *
 * This script continuously monitors market prices and executes trades
 * when strategy conditions are met (buy/sell thresholds crossed)
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDB as connectMongoDB } from '../plugins/mongo/mongo.js';
import Strategy from '../api/v1/models/trader/Strategy.js';
import Trade from '../api/v1/models/trader/Trade.js';
import ApiKey from '../api/v1/models/trader/ApiKey.js';

dotenv.config();

// Database connection function
async function connectToDatabase() {
  const dbUrl = process.env.DB_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017';
  const dbName = process.env.DB_NAME || 'madladslab';

  const connectionString = dbUrl.includes('mongodb')
    ? `${dbUrl}/${dbName}?retryWrites=true&w=majority`
    : `mongodb://${dbUrl}/${dbName}?retryWrites=true&w=majority`;

  // Connect both mongoose and native MongoDB driver
  await mongoose.connect(connectionString);
  await connectMongoDB();
}

// Configuration
const CHECK_INTERVAL = 15000; // Check every 15 seconds
const PRICE_CACHE_TTL = 30000; // Cache prices for 30 seconds

// Price cache to avoid hammering APIs
const priceCache = {
  data: {},
  timestamps: {}
};

// Track last execution to avoid duplicate trades
const lastExecutionTime = {};

// Logging utility
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data
  };

  if (level === 'ERROR') {
    console.error(`[${timestamp}] ERROR: ${message}`, data);
  } else if (level === 'WARN') {
    console.warn(`[${timestamp}] WARN: ${message}`, data);
  } else {
    console.log(`[${timestamp}] ${level}: ${message}`, data);
  }
}

/**
 * Fetch current market price for a trading pair
 */
async function getCurrentPrice(pair) {
  // Check cache first
  const now = Date.now();
  if (priceCache.data[pair] && (now - priceCache.timestamps[pair]) < PRICE_CACHE_TTL) {
    return priceCache.data[pair];
  }

  try {
    const response = await fetch(`https://api.exchange.coinbase.com/products/${pair}/ticker`);

    if (!response.ok) {
      throw new Error(`Coinbase API error: ${response.status}`);
    }

    const ticker = await response.json();
    const price = parseFloat(ticker.price);

    // Update cache
    priceCache.data[pair] = price;
    priceCache.timestamps[pair] = now;

    return price;
  } catch (error) {
    log('ERROR', 'Failed to fetch price', { pair, error: error.message });
    return null;
  }
}

/**
 * Check if buy conditions are met for a strategy
 */
function checkBuyConditions(strategy, currentPrice) {
  const conditions = strategy.buyConditions || {};

  // Check if we have buy price threshold
  if (conditions.priceBelow && currentPrice <= parseFloat(conditions.priceBelow)) {
    log('INFO', 'Buy condition met: Price below threshold', {
      strategy: strategy.name,
      pair: strategy.pair,
      currentPrice,
      threshold: conditions.priceBelow
    });
    return true;
  }

  if (conditions.priceAbove && currentPrice >= parseFloat(conditions.priceAbove)) {
    log('INFO', 'Buy condition met: Price above threshold', {
      strategy: strategy.name,
      pair: strategy.pair,
      currentPrice,
      threshold: conditions.priceAbove
    });
    return true;
  }

  return false;
}

/**
 * Check if sell conditions are met for a strategy
 */
function checkSellConditions(strategy, currentPrice) {
  const conditions = strategy.sellConditions || {};

  // Check if we have sell price threshold
  if (conditions.priceAbove && currentPrice >= parseFloat(conditions.priceAbove)) {
    log('INFO', 'Sell condition met: Price above threshold', {
      strategy: strategy.name,
      pair: strategy.pair,
      currentPrice,
      threshold: conditions.priceAbove
    });
    return true;
  }

  if (conditions.priceBelow && currentPrice <= parseFloat(conditions.priceBelow)) {
    log('INFO', 'Sell condition met: Price below threshold', {
      strategy: strategy.name,
      pair: strategy.pair,
      currentPrice,
      threshold: conditions.priceBelow
    });
    return true;
  }

  return false;
}

/**
 * Execute a buy trade for a strategy
 */
async function executeBuyTrade(strategy, apiKey, currentPrice) {
  try {
    const tradeModel = new Trade();

    // Calculate amount based on maxInvestment and current price
    let amount = 0;
    if (strategy.maxInvestment && currentPrice > 0) {
      amount = strategy.maxInvestment / currentPrice;
    } else {
      log('WARN', 'Cannot calculate trade amount', { strategy: strategy.name });
      return null;
    }

    const trade = await tradeModel.create({
      userId: strategy.userId,
      exchange: apiKey.exchange,
      pair: strategy.pair,
      side: 'buy',
      amount: amount,
      price: currentPrice,
      total: strategy.maxInvestment,
      status: 'pending',
      notes: `Auto-trade: ${strategy.name} (Buy at $${currentPrice})`,
      createdAt: new Date(),
      strategyId: strategy._id
    });

    log('SUCCESS', 'Buy trade created', {
      tradeId: trade._id,
      strategy: strategy.name,
      pair: strategy.pair,
      amount,
      price: currentPrice,
      total: strategy.maxInvestment
    });

    return trade;
  } catch (error) {
    log('ERROR', 'Failed to create buy trade', {
      strategy: strategy.name,
      error: error.message
    });
    return null;
  }
}

/**
 * Execute a sell trade for a strategy
 */
async function executeSellTrade(strategy, apiKey, currentPrice) {
  try {
    const tradeModel = new Trade();

    // Get user's holdings for this pair (from previous buys)
    const completedBuys = await tradeModel.getAll({
      userId: strategy.userId,
      pair: strategy.pair,
      side: 'buy',
      status: 'completed'
    });

    const completedSells = await tradeModel.getAll({
      userId: strategy.userId,
      pair: strategy.pair,
      side: 'sell',
      status: 'completed'
    });

    // Calculate net holdings
    let totalBought = completedBuys.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
    let totalSold = completedSells.reduce((sum, t) => sum + (parseFloat(t.amount) || 0), 0);
    let holdings = totalBought - totalSold;

    if (holdings <= 0) {
      log('WARN', 'No holdings to sell', {
        strategy: strategy.name,
        pair: strategy.pair
      });
      return null;
    }

    // Sell all holdings
    const amount = holdings;
    const total = amount * currentPrice;

    const trade = await tradeModel.create({
      userId: strategy.userId,
      exchange: apiKey.exchange,
      pair: strategy.pair,
      side: 'sell',
      amount: amount,
      price: currentPrice,
      total: total,
      status: 'pending',
      notes: `Auto-trade: ${strategy.name} (Sell at $${currentPrice})`,
      createdAt: new Date(),
      strategyId: strategy._id
    });

    log('SUCCESS', 'Sell trade created', {
      tradeId: trade._id,
      strategy: strategy.name,
      pair: strategy.pair,
      amount,
      price: currentPrice,
      total
    });

    return trade;
  } catch (error) {
    log('ERROR', 'Failed to create sell trade', {
      strategy: strategy.name,
      error: error.message
    });
    return null;
  }
}

/**
 * Check stop loss and take profit conditions
 */
async function checkStopLossAndTakeProfit(strategy, currentPrice) {
  try {
    const tradeModel = new Trade();

    // Get active buy trades for this strategy
    const activeBuys = await tradeModel.getAll({
      userId: strategy.userId,
      pair: strategy.pair,
      side: 'buy',
      status: 'completed',
      strategyId: strategy._id
    });

    if (activeBuys.length === 0) return;

    // Calculate average entry price
    let totalInvested = 0;
    let totalAmount = 0;

    activeBuys.forEach(trade => {
      totalInvested += parseFloat(trade.total) || 0;
      totalAmount += parseFloat(trade.amount) || 0;
    });

    if (totalAmount === 0) return;

    const avgEntryPrice = totalInvested / totalAmount;
    const profitPercent = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;

    log('DEBUG', 'Checking stop loss / take profit', {
      strategy: strategy.name,
      pair: strategy.pair,
      avgEntryPrice,
      currentPrice,
      profitPercent: profitPercent.toFixed(2) + '%'
    });

    // Check stop loss
    if (strategy.stopLoss && profitPercent <= -Math.abs(strategy.stopLoss)) {
      log('WARN', 'STOP LOSS TRIGGERED!', {
        strategy: strategy.name,
        pair: strategy.pair,
        profitPercent: profitPercent.toFixed(2) + '%',
        stopLoss: strategy.stopLoss + '%'
      });

      // Get API key for this user
      const apiKeyModel = new ApiKey();
      const apiKeys = await apiKeyModel.getAll({ userId: strategy.userId, isActive: true });

      if (apiKeys.length > 0) {
        await executeSellTrade(strategy, apiKeys[0], currentPrice);
      }
    }

    // Check take profit
    if (strategy.takeProfit && profitPercent >= strategy.takeProfit) {
      log('SUCCESS', 'TAKE PROFIT TRIGGERED!', {
        strategy: strategy.name,
        pair: strategy.pair,
        profitPercent: profitPercent.toFixed(2) + '%',
        takeProfit: strategy.takeProfit + '%'
      });

      // Get API key for this user
      const apiKeyModel = new ApiKey();
      const apiKeys = await apiKeyModel.getAll({ userId: strategy.userId, isActive: true });

      if (apiKeys.length > 0) {
        await executeSellTrade(strategy, apiKeys[0], currentPrice);
      }
    }
  } catch (error) {
    log('ERROR', 'Error checking stop loss/take profit', {
      strategy: strategy.name,
      error: error.message
    });
  }
}

/**
 * Process a single strategy
 */
async function processStrategy(strategy) {
  try {
    // Get current market price
    const currentPrice = await getCurrentPrice(strategy.pair);

    if (currentPrice === null) {
      log('WARN', 'Skipping strategy - no price data', { strategy: strategy.name });
      return;
    }

    // Prevent duplicate executions within 1 minute
    const executionKey = `${strategy._id}_${strategy.pair}`;
    const now = Date.now();
    if (lastExecutionTime[executionKey] && (now - lastExecutionTime[executionKey]) < 60000) {
      return; // Skip if we executed recently
    }

    log('DEBUG', 'Processing strategy', {
      strategy: strategy.name,
      pair: strategy.pair,
      type: strategy.strategyType,
      currentPrice
    });

    // Get user's API key
    const apiKeyModel = new ApiKey();
    const apiKeys = await apiKeyModel.getAll({ userId: strategy.userId, isActive: true });

    if (!apiKeys || apiKeys.length === 0) {
      log('WARN', 'No active API key for user', { strategy: strategy.name });
      return;
    }

    const apiKey = apiKeys[0];

    // Check buy conditions
    if (checkBuyConditions(strategy, currentPrice)) {
      await executeBuyTrade(strategy, apiKey, currentPrice);
      lastExecutionTime[executionKey] = now;
    }

    // Check sell conditions
    if (checkSellConditions(strategy, currentPrice)) {
      await executeSellTrade(strategy, apiKey, currentPrice);
      lastExecutionTime[executionKey] = now;
    }

    // Check stop loss and take profit
    await checkStopLossAndTakeProfit(strategy, currentPrice);

    // Update last run time
    const strategyModel = new Strategy();
    await strategyModel.updateById(strategy._id, { lastRun: new Date() });

  } catch (error) {
    log('ERROR', 'Error processing strategy', {
      strategy: strategy.name,
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Main monitoring loop
 */
async function monitorStrategies() {
  try {
    log('INFO', 'Checking active strategies...');

    const strategyModel = new Strategy();

    // Get all active strategies
    const activeStrategies = await strategyModel.getAll({ isActive: true });

    if (!activeStrategies || activeStrategies.length === 0) {
      log('DEBUG', 'No active strategies found');
      return;
    }

    log('INFO', `Found ${activeStrategies.length} active strategy(s)`);

    // Process each strategy
    for (const strategy of activeStrategies) {
      log('DEBUG', 'Strategy details', {
        name: strategy.name,
        type: strategy.strategyType,
        pair: strategy.pair,
        buyConditions: strategy.buyConditions,
        sellConditions: strategy.sellConditions
      });

      // Only process Manual strategies (for now)
      if (strategy.strategyType === 'Manual') {
        await processStrategy(strategy);
      } else {
        log('DEBUG', 'Skipping non-Manual strategy', { name: strategy.name, type: strategy.strategyType });
      }
    }

  } catch (error) {
    log('ERROR', 'Error in monitoring loop', {
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Start the monitoring service
 */
async function start() {
  log('INFO', '========================================');
  log('INFO', 'Trading Bot Monitor Starting...');
  log('INFO', `Check interval: ${CHECK_INTERVAL / 1000} seconds`);
  log('INFO', '========================================');

  // Connect to database
  try {
    await connectToDatabase();
    log('SUCCESS', 'Database connection established');
  } catch (error) {
    log('ERROR', 'Failed to connect to database', { error: error.message, stack: error.stack });
    process.exit(1);
  }

  // Run first check immediately
  await monitorStrategies();

  // Set up recurring checks
  setInterval(async () => {
    await monitorStrategies();
  }, CHECK_INTERVAL);

  log('INFO', 'Monitor is running. Press Ctrl+C to stop.');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('INFO', 'Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('INFO', 'Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

// Catch unhandled errors
process.on('uncaughtException', (error) => {
  log('ERROR', 'Uncaught exception', { error: error.message, stack: error.stack });
});

process.on('unhandledRejection', (reason, promise) => {
  log('ERROR', 'Unhandled rejection', { reason, promise });
});

// Start the monitor
start().catch(error => {
  log('ERROR', 'Fatal error starting monitor', { error: error.message });
  process.exit(1);
});
