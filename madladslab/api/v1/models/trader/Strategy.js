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
    lastRun: { type: 'date', value: null, editable: false },
    createdAt: { type: 'date', value: null, editable: false }
  }
}
