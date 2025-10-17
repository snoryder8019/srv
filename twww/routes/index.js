var express = require('express');
var router = express.Router();

// Top 50 Fiat Payment Services
const fiatServices = [
  { name: 'PayPal', url: 'https://www.paypal.com', category: 'Digital Wallet' },
  { name: 'Venmo', url: 'https://venmo.com', category: 'P2P Payment' },
  { name: 'Cash App', url: 'https://cash.app', category: 'P2P Payment' },
  { name: 'Zelle', url: 'https://www.zellepay.com', category: 'Bank Transfer' },
  { name: 'Apple Pay', url: 'https://www.apple.com/apple-pay', category: 'Digital Wallet' },
  { name: 'Google Pay', url: 'https://pay.google.com', category: 'Digital Wallet' },
  { name: 'Samsung Pay', url: 'https://www.samsung.com/us/samsung-pay', category: 'Digital Wallet' },
  { name: 'Stripe', url: 'https://stripe.com', category: 'Payment Gateway' },
  { name: 'Square', url: 'https://squareup.com', category: 'Payment Gateway' },
  { name: 'Wise (TransferWise)', url: 'https://wise.com', category: 'International Transfer' },
  { name: 'Revolut', url: 'https://www.revolut.com', category: 'Digital Banking' },
  { name: 'Chime', url: 'https://www.chime.com', category: 'Digital Banking' },
  { name: 'Chase Bank', url: 'https://www.chase.com', category: 'Traditional Bank' },
  { name: 'Wells Fargo', url: 'https://www.wellsfargo.com', category: 'Traditional Bank' },
  { name: 'Bank of America', url: 'https://www.bankofamerica.com', category: 'Traditional Bank' },
  { name: 'Citibank', url: 'https://www.citibank.com', category: 'Traditional Bank' },
  { name: 'Capital One', url: 'https://www.capitalone.com', category: 'Traditional Bank' },
  { name: 'US Bank', url: 'https://www.usbank.com', category: 'Traditional Bank' },
  { name: 'PNC Bank', url: 'https://www.pnc.com', category: 'Traditional Bank' },
  { name: 'TD Bank', url: 'https://www.td.com', category: 'Traditional Bank' },
  { name: 'American Express', url: 'https://www.americanexpress.com', category: 'Credit Card' },
  { name: 'Discover', url: 'https://www.discover.com', category: 'Credit Card' },
  { name: 'Mastercard', url: 'https://www.mastercard.us', category: 'Credit Card' },
  { name: 'Visa', url: 'https://www.visa.com', category: 'Credit Card' },
  { name: 'Western Union', url: 'https://www.westernunion.com', category: 'Money Transfer' },
  { name: 'MoneyGram', url: 'https://www.moneygram.com', category: 'Money Transfer' },
  { name: 'Remitly', url: 'https://www.remitly.com', category: 'International Transfer' },
  { name: 'Xoom', url: 'https://www.xoom.com', category: 'International Transfer' },
  { name: 'WorldRemit', url: 'https://www.worldremit.com', category: 'International Transfer' },
  { name: 'Skrill', url: 'https://www.skrill.com', category: 'Digital Wallet' },
  { name: 'Payoneer', url: 'https://www.payoneer.com', category: 'Payment Gateway' },
  { name: 'Klarna', url: 'https://www.klarna.com', category: 'Buy Now Pay Later' },
  { name: 'Afterpay', url: 'https://www.afterpay.com', category: 'Buy Now Pay Later' },
  { name: 'Affirm', url: 'https://www.affirm.com', category: 'Buy Now Pay Later' },
  { name: 'Sezzle', url: 'https://sezzle.com', category: 'Buy Now Pay Later' },
  { name: 'Braintree', url: 'https://www.braintreepayments.com', category: 'Payment Gateway' },
  { name: 'Adyen', url: 'https://www.adyen.com', category: 'Payment Gateway' },
  { name: 'PayU', url: 'https://www.payu.com', category: 'Payment Gateway' },
  { name: 'Alipay', url: 'https://global.alipay.com', category: 'Digital Wallet' },
  { name: 'WeChat Pay', url: 'https://pay.weixin.qq.com', category: 'Digital Wallet' },
  { name: 'Paytm', url: 'https://paytm.com', category: 'Digital Wallet' },
  { name: 'PhonePe', url: 'https://www.phonepe.com', category: 'Digital Wallet' },
  { name: 'Google Wallet', url: 'https://wallet.google.com', category: 'Digital Wallet' },
  { name: 'Dwolla', url: 'https://www.dwolla.com', category: 'ACH Payment' },
  { name: 'Plaid', url: 'https://plaid.com', category: 'Banking API' },
  { name: 'N26', url: 'https://n26.com', category: 'Digital Banking' },
  { name: 'Monzo', url: 'https://monzo.com', category: 'Digital Banking' },
  { name: 'Starling Bank', url: 'https://www.starlingbank.com', category: 'Digital Banking' },
  { name: 'SoFi', url: 'https://www.sofi.com', category: 'Digital Banking' },
  { name: 'Ally Bank', url: 'https://www.ally.com', category: 'Digital Banking' }
];

// Top 15 Crypto Exchanges
const cryptoExchanges = [
  { name: 'Binance', url: 'https://www.binance.com', type: 'Centralized' },
  { name: 'Coinbase', url: 'https://www.coinbase.com', type: 'Centralized' },
  { name: 'Kraken', url: 'https://www.kraken.com', type: 'Centralized' },
  { name: 'Crypto.com', url: 'https://crypto.com', type: 'Centralized' },
  { name: 'KuCoin', url: 'https://www.kucoin.com', type: 'Centralized' },
  { name: 'Bybit', url: 'https://www.bybit.com', type: 'Centralized' },
  { name: 'OKX', url: 'https://www.okx.com', type: 'Centralized' },
  { name: 'Bitfinex', url: 'https://www.bitfinex.com', type: 'Centralized' },
  { name: 'Gate.io', url: 'https://www.gate.io', type: 'Centralized' },
  { name: 'Gemini', url: 'https://www.gemini.com', type: 'Centralized' },
  { name: 'Bitstamp', url: 'https://www.bitstamp.net', type: 'Centralized' },
  { name: 'Uniswap', url: 'https://uniswap.org', type: 'Decentralized (DEX)' },
  { name: 'PancakeSwap', url: 'https://pancakeswap.finance', type: 'Decentralized (DEX)' },
  { name: 'dYdX', url: 'https://dydx.exchange', type: 'Decentralized (DEX)' },
  { name: 'SushiSwap', url: 'https://www.sushi.com', type: 'Decentralized (DEX)' }
];

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', {
    title: 'The World Wide Wallet',
    fiatServices: fiatServices,
    cryptoExchanges: cryptoExchanges
  });
});

module.exports = router;
