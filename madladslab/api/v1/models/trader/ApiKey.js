import ModelHelper from "../helpers/models.js";

// Model for storing Coinbase API keys securely
export default class ApiKey extends ModelHelper {
  constructor(apiKeyData) {
    super('traderApiKeys');
  }

  static modelFields = {
    userId: { type: 'text', value: null, editable: false },
    name: { type: 'text', value: null, editable: true },
    exchange: { type: 'dropdown', options: ['Coinbase', 'Coinbase Pro', 'Binance', 'Kraken'], value: 'Coinbase', editable: true },
    apiKey: { type: 'text', value: null, editable: true },
    apiSecret: { type: 'hidden', value: null, editable: true }, // Hidden for security
    isActive: { type: 'boolean', value: true, editable: true },
    lastUsed: { type: 'date', value: null, editable: false },
    createdAt: { type: 'date', value: null, editable: false }
  }
}
