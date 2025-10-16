import ModelHelper from "../helpers/models.js";

// Model for automated trading strategies
export default class Strategy extends ModelHelper {
  constructor(strategyData) {
    super('tradingStrategies');
  }

  static modelFields = {
    userId: { type: 'text', value: null, editable: false },
    name: { type: 'text', value: null, editable: true },
    description: { type: 'text', value: null, editable: true },
    pair: { type: 'text', value: 'BTC-USD', editable: true }, // Trading pair
    strategyType: { type: 'dropdown', options: ['DCA', 'Grid', 'Momentum', 'Manual'], value: 'Manual', editable: true },
    isActive: { type: 'boolean', value: false, editable: true },
    buyConditions: { type: 'object', value: {}, editable: true }, // JSON for buy rules
    sellConditions: { type: 'object', value: {}, editable: true }, // JSON for sell rules
    maxInvestment: { type: 'number', value: 100, editable: true },
    stopLoss: { type: 'number', value: null, editable: true }, // Percentage
    takeProfit: { type: 'number', value: null, editable: true }, // Percentage
    interval: { type: 'dropdown', options: ['1m', '5m', '15m', '1h', '4h', '1d'], value: '1h', editable: true },
    // Bot trading parameters
    tradeAmount: { type: 'number', value: 10, editable: true }, // Amount per trade in USD
    maxTrades: { type: 'number', value: 10, editable: true }, // Max concurrent trades
    checkInterval: { type: 'number', value: 60, editable: true }, // Check every X seconds
    isRunning: { type: 'boolean', value: false, editable: false }, // Monitor status
    apiKeyId: { type: 'text', value: null, editable: true }, // Associated API key
    lastRun: { type: 'date', value: null, editable: false },
    totalRuns: { type: 'number', value: 0, editable: false }, // Total execution count
    successfulTrades: { type: 'number', value: 0, editable: false },
    failedTrades: { type: 'number', value: 0, editable: false },
    createdAt: { type: 'date', value: null, editable: false }
  }
}
