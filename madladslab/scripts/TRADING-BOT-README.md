# Automated Trading Bot Monitor

## Overview

The Trading Bot Monitor is an automated background service that continuously monitors market prices and executes trades when your strategy conditions are met. It checks prices every 15 seconds and automatically buys or sells based on your configured thresholds.

## Features

- **Price Threshold Monitoring**: Automatically executes trades when prices cross your buy/sell thresholds
- **Stop Loss Protection**: Automatically sells when losses reach your configured limit
- **Take Profit Automation**: Automatically sells when profits reach your target
- **Smart Caching**: Minimizes API calls with intelligent price caching
- **Duplicate Prevention**: Prevents multiple trades within 60 seconds of each other
- **Comprehensive Logging**: Full audit trail of all automated decisions and trades

## How It Works

### 1. Price Monitoring
The bot checks current market prices every 15 seconds from Coinbase Exchange API.

### 2. Strategy Evaluation
For each active "Manual" strategy, it checks:
- **Buy Conditions**: If current price crosses your buy threshold
- **Sell Conditions**: If current price crosses your sell threshold
- **Stop Loss**: If your position losses exceed your tolerance
- **Take Profit**: If your position profits reach your target

### 3. Automatic Execution
When conditions are met, the bot automatically creates pending trades in your account.

## Setting Up Your Strategy

### Buy Condition Examples

To buy when price **drops below** a threshold:
```json
{
  "priceBelow": 65000
}
```
This will buy BTC when it drops to $65,000 or below.

To buy when price **rises above** a threshold (breakout):
```json
{
  "priceAbove": 70000
}
```
This will buy BTC when it breaks above $70,000.

### Sell Condition Examples

To sell when price **rises above** a threshold (take profit):
```json
{
  "priceAbove": 75000
}
```
This will sell BTC when it rises to $75,000 or above.

To sell when price **drops below** a threshold (cut losses):
```json
{
  "priceBelow": 60000
}
```
This will sell BTC when it drops to $60,000 or below.

### Stop Loss & Take Profit

Set these as percentages in your strategy:
- **Stop Loss**: `-5` means sell if you're down 5%
- **Take Profit**: `10` means sell if you're up 10%

These are calculated based on your average entry price.

## Managing the Monitor

### Start the Monitor
```bash
cd /srv/madladslab
./scripts/start-trading-monitor.sh
```

### Stop the Monitor
```bash
./scripts/stop-trading-monitor.sh
```

### Check Status
```bash
./scripts/status-trading-monitor.sh
```

### View Live Logs
```bash
tail -f logs/trading-monitor.log
```

## Complete Example Strategy

Let's say you want to:
1. Buy BTC when it drops to $65,000
2. Sell when it rises to $70,000 (7.7% profit)
3. Or sell if it drops below your stop loss of 3%

**Strategy Configuration:**
- Name: `BTC Dip Buyer`
- Type: `Manual`
- Pair: `BTC-USD`
- Max Investment: `1000` (invest $1,000)
- Stop Loss: `3` (exit at -3%)
- Take Profit: `7.7` (exit at +7.7%)

**Buy Conditions:**
```json
{
  "priceBelow": 65000
}
```

**Sell Conditions:**
```json
{
  "priceAbove": 70000
}
```

**What Happens:**
1. When BTC drops to $65,000, the bot automatically creates a buy order for $1,000 worth of BTC
2. The bot then monitors your position
3. If BTC rises to $70,000, it automatically sells (7.7% profit)
4. If BTC drops and you're down 3%, it automatically sells (stop loss protection)
5. All actions are logged and visible in your trade history

## Log Levels

- **INFO**: Normal operations (strategy checks, prices fetched)
- **SUCCESS**: Trades created, conditions met
- **WARN**: No API keys, no holdings to sell, skipped strategies
- **ERROR**: API failures, database errors
- **DEBUG**: Detailed price and strategy evaluation info

## Safety Features

1. **No Duplicate Trades**: Won't execute the same strategy twice within 60 seconds
2. **Price Cache**: Reduces API load by caching prices for 30 seconds
3. **Active Strategies Only**: Only processes strategies you've marked as "Active"
4. **Manual Type Only**: Currently only processes "Manual" type strategies
5. **Graceful Shutdown**: Handles SIGINT/SIGTERM cleanly

## Troubleshooting

### Monitor Won't Start
- Check if it's already running: `./scripts/status-trading-monitor.sh`
- Check logs: `cat logs/trading-monitor.log`
- Verify database connection in your `.env` file

### No Trades Being Executed
1. Is the monitor running? Check status
2. Is your strategy marked as "Active"?
3. Is the strategy type set to "Manual"?
4. Do you have an active API key?
5. Has the price actually crossed your threshold?
6. Check logs for details

### Trades Not Showing in UI
- Refresh the page
- Trades appear in "Pending Trades" section
- Check the "Recent Trades" section

## Important Notes

⚠️ **Start Small**: Test with small amounts first

⚠️ **Monitor Regularly**: Check logs and trade history frequently

⚠️ **Market Orders**: Currently creates "pending" trades at market price

⚠️ **Paper Trading**: No real exchange integration yet - trades are logged only

⚠️ **API Key Required**: You must have an active API key configured

## System Requirements

- Node.js 14+
- MongoDB connection
- Active API key in the system
- At least one active "Manual" strategy

## Logs Location

All logs are written to: `/srv/madladslab/logs/trading-monitor.log`

## Process Management

The monitor runs as a background daemon process. Its PID is stored in:
`/srv/madladslab/logs/trading-monitor.pid`

## Future Enhancements

- [ ] Real Coinbase API integration for actual trade execution
- [ ] Email/SMS notifications for trades
- [ ] Support for DCA, Grid, and Momentum strategies
- [ ] Advanced technical indicators (RSI, MACD, etc.)
- [ ] Multi-exchange support
- [ ] Position sizing strategies
- [ ] Trailing stop losses

## Support

Check logs first: `tail -f logs/trading-monitor.log`

For issues, include:
- Strategy configuration
- Relevant log entries
- Current price and expected behavior
