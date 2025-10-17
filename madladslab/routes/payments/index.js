import express from "express";
const router = express.Router();

// Payment configuration
const PAYMENT_METHODS = {
  fiat: [
    {
      id: 'stripe',
      name: 'Stripe',
      icon: '💳',
      description: 'Credit/Debit Cards',
      featured: true,
      enabled: true,
      fees: '2.9% + $0.30',
      link: process.env.STRIPE_PAYMENT_LINK || '#'
    },
    {
      id: 'paypal',
      name: 'PayPal',
      icon: '🅿️',
      description: 'PayPal Account',
      featured: true,
      enabled: true,
      fees: '2.9% + $0.30',
      link: process.env.PAYPAL_PAYMENT_LINK || '#'
    },
    {
      id: 'venmo',
      name: 'Venmo',
      icon: '💙',
      description: 'Quick mobile payments',
      featured: false,
      enabled: true,
      fees: 'Free',
      link: process.env.VENMO_USERNAME ? `https://venmo.com/${process.env.VENMO_USERNAME}` : '#'
    },
    {
      id: 'cashapp',
      name: 'Cash App',
      icon: '💵',
      description: 'Cash App payments',
      featured: false,
      enabled: true,
      fees: 'Free',
      link: process.env.CASHAPP_TAG ? `https://cash.app/$${process.env.CASHAPP_TAG}` : '#'
    },
    {
      id: 'zelle',
      name: 'Zelle',
      icon: '⚡',
      description: 'Bank-to-bank transfer',
      featured: false,
      enabled: true,
      fees: 'Free',
      info: process.env.ZELLE_EMAIL || 'Email available on request'
    }
  ],
  crypto: [
    {
      id: 'bitcoin',
      name: 'Bitcoin',
      symbol: 'BTC',
      icon: '₿',
      description: 'Bitcoin payments',
      featured: true,
      enabled: true,
      network: 'Bitcoin',
      address: process.env.BTC_ADDRESS || '',
      qrCode: true
    },
    {
      id: 'ethereum',
      name: 'Ethereum',
      symbol: 'ETH',
      icon: 'Ξ',
      description: 'Ethereum payments',
      featured: true,
      enabled: true,
      network: 'Ethereum',
      address: process.env.ETH_ADDRESS || '',
      qrCode: true
    },
    {
      id: 'usdc',
      name: 'USD Coin',
      symbol: 'USDC',
      icon: '💲',
      description: 'Stablecoin payments',
      featured: true,
      enabled: true,
      network: 'Ethereum/Polygon',
      address: process.env.USDC_ADDRESS || process.env.ETH_ADDRESS || '',
      qrCode: true
    },
    {
      id: 'solana',
      name: 'Solana',
      symbol: 'SOL',
      icon: '◎',
      description: 'Fast & low-cost payments',
      featured: false,
      enabled: true,
      network: 'Solana',
      address: process.env.SOL_ADDRESS || '',
      qrCode: true
    },
    {
      id: 'litecoin',
      name: 'Litecoin',
      symbol: 'LTC',
      icon: 'Ł',
      description: 'Litecoin payments',
      featured: false,
      enabled: true,
      network: 'Litecoin',
      address: process.env.LTC_ADDRESS || '',
      qrCode: true
    }
  ]
};

// Main payment page route
router.get('/', (req, res) => {
  const user = req.user;

  // Filter enabled payment methods
  const fiatMethods = PAYMENT_METHODS.fiat.filter(m => m.enabled);
  const cryptoMethods = PAYMENT_METHODS.crypto.filter(m => m.enabled);

  // Get featured methods
  const featuredFiat = fiatMethods.filter(m => m.featured);
  const featuredCrypto = cryptoMethods.filter(m => m.featured);

  res.render('payments/index', {
    user,
    fiatMethods,
    cryptoMethods,
    featuredFiat,
    featuredCrypto,
    pageTitle: 'Payment Options'
  });
});

// Get specific payment method details
router.get('/method/:type/:id', (req, res) => {
  const user = req.user;
  const { type, id } = req.params;

  if (!['fiat', 'crypto'].includes(type)) {
    return res.status(404).send('Invalid payment type');
  }

  const method = PAYMENT_METHODS[type].find(m => m.id === id);

  if (!method || !method.enabled) {
    return res.status(404).send('Payment method not found');
  }

  res.render('payments/method', {
    user,
    method,
    type,
    pageTitle: `Pay with ${method.name}`
  });
});

// API endpoint to get payment methods
router.get('/api/methods', (req, res) => {
  const fiat = PAYMENT_METHODS.fiat.filter(m => m.enabled).map(m => ({
    id: m.id,
    name: m.name,
    icon: m.icon,
    description: m.description,
    featured: m.featured,
    fees: m.fees
  }));

  const crypto = PAYMENT_METHODS.crypto.filter(m => m.enabled).map(m => ({
    id: m.id,
    name: m.name,
    symbol: m.symbol,
    icon: m.icon,
    description: m.description,
    featured: m.featured,
    network: m.network
  }));

  res.json({ fiat, crypto });
});

// Generate QR code for crypto addresses
router.get('/api/qr/:type/:id', async (req, res) => {
  const { type, id } = req.params;

  if (type !== 'crypto') {
    return res.status(400).json({ error: 'QR codes only available for crypto' });
  }

  const method = PAYMENT_METHODS.crypto.find(m => m.id === id);

  if (!method || !method.enabled || !method.address) {
    return res.status(404).json({ error: 'Address not configured' });
  }

  // Return address for QR code generation on client side
  res.json({
    address: method.address,
    name: method.name,
    symbol: method.symbol,
    network: method.network
  });
});

export default router;
