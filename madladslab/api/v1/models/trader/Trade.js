import ModelHelper from "../helpers/models.js";

// Model for tracking trades
export default class Trade extends ModelHelper {
  constructor(tradeData) {
    super('trades');
  }

  static modelFields = {
    userId: { type: 'text', value: null, editable: false },
    exchange: { type: 'text', value: 'Coinbase', editable: false },
    pair: { type: 'text', value: null, editable: false }, // e.g., BTC-USD
    side: { type: 'dropdown', options: ['buy', 'sell'], value: 'buy', editable: false },
    amount: { type: 'number', value: null, editable: false },
    price: { type: 'number', value: null, editable: false },
    total: { type: 'number', value: null, editable: false },
    fee: { type: 'number', value: 0, editable: false },
    status: { type: 'dropdown', options: ['pending', 'completed', 'failed', 'cancelled'], value: 'pending', editable: true },
    orderId: { type: 'text', value: null, editable: false },
    notes: { type: 'text', value: null, editable: true },
    executedAt: { type: 'date', value: null, editable: false },
    createdAt: { type: 'date', value: null, editable: false }
  }
}
