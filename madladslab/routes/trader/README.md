# Coinbase Trader Bot

A comprehensive trading bot interface for Coinbase and other cryptocurrency exchanges.

## Features

- 🔑 **API Key Management**: Securely store and manage multiple exchange API keys
- 💹 **Trading**: Execute buy/sell orders through integrated APIs
- 📊 **Strategies**: Create and manage automated trading strategies
- 📈 **Trade History**: Track all executed trades
- 💼 **Portfolio**: Monitor your holdings and performance

## Setup

### 1. Database Models

Three models are included:

- **ApiKey** (`/api/v1/models/trader/ApiKey.js`): Stores exchange API credentials
- **Trade** (`/api/v1/models/trader/Trade.js`): Records all trade executions
- **Strategy** (`/api/v1/models/trader/Strategy.js`): Automated trading strategies

### 2. Routes

All routes are prefixed with `/trader` and require authentication.

#### API Key Routes:
- `GET /trader/api-keys` - List all API keys
- `POST /trader/api-keys` - Add new API key
- `PUT /trader/api-keys/:id` - Update API key
- `DELETE /trader/api-keys/:id` - Delete API key
- `POST /trader/api-keys/:id/test` - Test API connection

#### Trading Routes:
- `GET /trader/market/:pair` - Get market data for a trading pair
- `POST /trader/trade` - Execute a trade
- `GET /trader/trades` - Get trade history

#### Strategy Routes:
- `GET /trader/strategies` - List all strategies
- `POST /trader/strategies` - Create new strategy
- `PUT /trader/strategies/:id` - Update strategy
- `DELETE /trader/strategies/:id` - Delete strategy
- `POST /trader/strategies/:id/toggle` - Activate/deactivate strategy

#### Analytics:
- `GET /trader/portfolio` - Get portfolio summary

### 3. Coinbase Integration

To integrate with Coinbase API, you'll need to:

1. Install the Coinbase SDK:
```bash
npm install coinbase
```

2. Add your implementation in the routes where marked with `// TODO:`

Example Coinbase integration:
```javascript
import { Client } from 'coinbase';

// In your route handler
const client = new Client({
  apiKey: apiKeyData.apiKey,
  apiSecret: apiKeyData.apiSecret
});

// Get account balance
client.getAccounts({}, (err, accounts) => {
  // Handle accounts
});

// Place order
client.buy({
  accountId: 'xxx',
  amount: '0.01',
  currency: 'BTC'
}, (err, response) => {
  // Handle response
});
```

### 4. Security Considerations

**IMPORTANT**: The API secrets are currently stored in plain text. Before production:

1. **Encrypt API secrets** before storing:
```javascript
import crypto from 'crypto';

const algorithm = 'aes-256-cbc';
const key = crypto.randomBytes(32);
const iv = crypto.randomBytes(16);

function encrypt(text) {
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return encrypted.toString('hex');
}

function decrypt(text) {
  const encryptedText = Buffer.from(text, 'hex');
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}
```

2. **Store encryption keys in environment variables**
3. **Use HTTPS only** for production
4. **Implement rate limiting** to prevent API abuse
5. **Add two-factor authentication** for sensitive operations
6. **Log all trading activities** for audit trails

### 5. Environment Variables

Add to your `.env` file:
```env
# Coinbase API (if using server-side keys)
COINBASE_API_KEY=your_api_key
COINBASE_API_SECRET=your_api_secret

# Encryption
CRYPTO_KEY=your_32_byte_key
CRYPTO_IV=your_16_byte_iv
```

## Usage

1. Navigate to `/trader` in your application
2. Add your Coinbase API keys
3. Test the connection
4. Start trading manually or create automated strategies

## API Examples

### Add API Key
```javascript
POST /trader/api-keys
Content-Type: application/json

{
  "name": "My Coinbase Account",
  "exchange": "Coinbase",
  "apiKey": "your_api_key",
  "apiSecret": "your_api_secret"
}
```

### Execute Trade
```javascript
POST /trader/trade
Content-Type: application/json

{
  "apiKeyId": "xxx",
  "pair": "BTC-USD",
  "side": "buy",
  "amount": 0.001,
  "price": 45000
}
```

### Create Strategy
```javascript
POST /trader/strategies
Content-Type: application/json

{
  "name": "DCA Bitcoin",
  "description": "Buy $100 BTC every week",
  "pair": "BTC-USD",
  "strategyType": "DCA",
  "maxInvestment": 100,
  "interval": "1d"
}
```

## Next Steps

1. **Implement Coinbase SDK**: Replace TODO comments with actual API calls
2. **Add encryption**: Secure API secrets before storing
3. **Create strategy executor**: Background job to run active strategies
4. **Add notifications**: Email/SMS alerts for trades
5. **Build analytics**: Charts and performance tracking
6. **Add backtesting**: Test strategies on historical data
7. **Implement stop-loss/take-profit**: Automatic risk management

## Testing

Before using real funds:
1. Use Coinbase Sandbox/Testnet
2. Start with very small amounts
3. Test all API connections thoroughly
4. Monitor trades closely

## Support

For issues or questions, contact your development team.

**⚠️ WARNING**: Trading cryptocurrencies carries significant risk. Only invest what you can afford to lose.
