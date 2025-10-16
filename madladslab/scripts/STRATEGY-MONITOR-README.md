# Strategy Monitor - Automated Trading Bot

## Overview

The Strategy Monitor is an automated background process that continuously monitors and executes your trading strategies based on configured parameters.

## Features

- **Continuous Monitoring**: Checks active strategies at configured intervals
- **Automated Trading**: Executes buy/sell orders when conditions are met
- **Risk Management**: Respects max trades, stop loss, and take profit settings
- **Real-time Monitoring**: Shows strategy status in the trader dashboard
- **Multiple Strategies**: Can run multiple strategies simultaneously

## Strategy Parameters

### Bot Trading Parameters
- **Trade Amount**: USD amount per trade (e.g., $10)
- **Max Concurrent Trades**: Maximum number of open trades (e.g., 10)
- **Check Interval**: How often to check conditions in seconds (e.g., 60s)

### Risk Management
- **Max Investment**: Total maximum investment for this strategy
- **Stop Loss**: Percentage loss to trigger auto-sell (optional)
- **Take Profit**: Percentage gain to trigger auto-sell (optional)

### Buy/Sell Conditions
- **Buy when price drops BELOW**: Execute buy when price falls below this value
- **Buy when price rises ABOVE**: Execute buy on breakout above this value
- **Sell when price rises ABOVE**: Take profit when price exceeds this value
- **Sell when price drops BELOW**: Cut losses when price falls below this value

## How It Works

1. **Create a Strategy** in the trader dashboard
2. **Configure bot parameters** (trade amount, check interval, etc.)
3. **Set buy/sell conditions** (price triggers)
4. **Click "Start"** to begin monitoring
5. **Monitor runs in background** checking prices at configured intervals
6. **Automatic execution** when conditions are met
7. **View statistics** (runs, successful trades, failed trades)

## Starting the Monitor

### Option 1: From the Web Interface
1. Go to `/trader` dashboard
2. Find your strategy in the "Trading Strategies" section
3. Click the **"▶ Start"** button

### Option 2: From Command Line
```bash
cd /srv/madladslab
./scripts/start-strategy-monitor.sh
```

## Stopping the Monitor

### Option 1: From the Web Interface
1. Go to `/trader` dashboard
2. Find your running strategy
3. Click the **"⏹ Stop"** button

### Option 2: From Command Line
```bash
./scripts/stop-strategy-monitor.sh
```

## Checking Status

```bash
./scripts/status-strategy-monitor.sh
```

Or attach to the live monitor:
```bash
tmux attach -t strategy-monitor
```
(Press `Ctrl+B` then `D` to detach without stopping)

## Example Strategy

### DCA (Dollar Cost Average) Strategy
```
Name: BTC Weekly DCA
Pair: BTC-USD
Trade Amount: $50
Max Trades: 10
Check Interval: 3600 (1 hour)

Buy Conditions:
- Buy when price drops BELOW: $95,000

Risk Management:
- Max Investment: $500
- Stop Loss: 5%
- Take Profit: 10%
```

**How it works:**
- Every hour, checks if BTC price is below $95,000
- If yes, buys $50 worth of BTC
- Stops after 10 purchases or $500 total invested
- Auto-sells if price drops 5% or gains 10%

### Grid Trading Strategy
```
Name: ETH Grid Trading
Pair: ETH-USD
Trade Amount: $25
Max Trades: 20
Check Interval: 300 (5 minutes)

Buy Conditions:
- Buy when price drops BELOW: $3,400

Sell Conditions:
- Sell when price rises ABOVE: $3,500
```

**How it works:**
- Buys ETH when price dips below $3,400
- Sells ETH when price rises above $3,500
- Creates a grid of buy/sell orders
- Maximum 20 concurrent positions

## Monitor Logs

The monitor outputs detailed logs showing:
- ✅ When strategies are started
- 🔄 Each execution check
- 🟢 Buy signals and orders
- 🔴 Sell signals and orders
- ⏸️ When conditions aren't met
- ⚠️ Warnings (max trades, missing API keys, etc.)

Example log:
```
🤖 Strategy Monitor Started
⏰ Checking for active strategies every 10 seconds...

[2:34:15 PM] Found 2 running strategies
✅ Starting monitor for: BTC Weekly DCA (BTC-USD)
✅ Starting monitor for: ETH Grid Trading (ETH-USD)

🔄 [2:35:00 PM] Executing: BTC Weekly DCA
   Current BTC-USD price: $94,850.00
   🟢 BUY Signal: Price dropped below $95000
   ✅ BUY order created: 0.00052681 BTC

🔄 [2:35:05 PM] Executing: ETH Grid Trading
   Current ETH-USD price: $3,425.00
   ⏸️  No action - Conditions not met
```

## Tmux Session Management

The monitor runs in a tmux session named `strategy-monitor`:

```bash
# List all tmux sessions
tmux ls

# Attach to monitor session
tmux attach -t strategy-monitor

# Detach without stopping (Ctrl+B, then D)
# Or force detach from another terminal:
tmux detach -s strategy-monitor

# Kill the session (stops monitor)
tmux kill-session -t strategy-monitor
```

## Troubleshooting

### Monitor won't start
- Check if already running: `./scripts/status-strategy-monitor.sh`
- Check database connection in logs
- Verify tmux is installed: `tmux -V`

### Strategies not executing
- Ensure strategy is marked as "🤖 RUNNING" in dashboard
- Check monitor logs: `tmux attach -t strategy-monitor`
- Verify API key is configured and active
- Check buy/sell conditions are set correctly

### No trades being created
- Verify price conditions match current market
- Check if max trades limit is reached
- Ensure sufficient balance in account
- Look for error messages in monitor logs

## Safety Features

- **Max Trades Limit**: Prevents over-trading
- **Max Investment**: Caps total capital at risk
- **Stop Loss**: Auto-exit on losses
- **Take Profit**: Auto-exit on gains
- **Dry Run Testing**: Test strategies without real trades (coming soon)

## Architecture

```
Web Interface (trader/index.ejs)
    ↓
API Routes (/trader/strategies/:id/start-monitor)
    ↓
Database (marks strategy as isRunning: true)
    ↓
Strategy Monitor Script (scripts/strategy-monitor.js)
    ↓ (checks every 10 seconds)
Loads Running Strategies from DB
    ↓ (for each strategy)
Checks Conditions Every X Seconds
    ↓ (if conditions met)
Creates Trade in Database
    ↓
Updates Strategy Stats
```

## File Locations

- **Monitor Script**: `/srv/madladslab/scripts/strategy-monitor.js`
- **Helper Scripts**: `/srv/madladslab/scripts/*-strategy-monitor.sh`
- **Strategy Model**: `/srv/madladslab/api/v1/models/trader/Strategy.js`
- **API Routes**: `/srv/madladslab/routes/trader/index.js`
- **Web Interface**: `/srv/madladslab/views/trader/index.ejs`

## Future Enhancements

- [ ] Technical indicators (RSI, MACD, Moving Averages)
- [ ] Webhook notifications (Discord, Telegram, Email)
- [ ] Backtesting with historical data
- [ ] Portfolio rebalancing
- [ ] Multi-exchange support
- [ ] Advanced order types (limit, stop-limit)
- [ ] Strategy templates and presets

## Support

For issues or questions, check:
1. Monitor logs: `tmux attach -t strategy-monitor`
2. Server logs: Check your main application logs
3. Database: Verify strategies are saved correctly

---

**⚠️ Important**: This is automated trading software. Start with small amounts and thoroughly test your strategies. Never invest more than you can afford to lose.
