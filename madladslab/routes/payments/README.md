# Payment Link Aggregator Package

A centralized payment system supporting both **fiat** (traditional) and **cryptocurrency** payment methods.

## Features

### Fiat Payments (Priority 1st)
- **Featured Methods**: Stripe, PayPal (highlighted with special styling)
- **Additional Methods**: Venmo, Cash App, Zelle
- Direct links to payment processors
- Fee transparency displayed for each method

### Cryptocurrency Payments (1/3 Featured)
- **Featured Crypto**: Bitcoin (BTC), Ethereum (ETH), USD Coin (USDC)
- **Additional Crypto**: Solana (SOL), Litecoin (LTC)
- QR code generation for easy mobile payments
- Network information displayed for safety
- Copy-to-clipboard functionality for addresses

## Installation & Setup

### 1. Copy Environment Variables
```bash
cp .env.payments.example .env
```

### 2. Configure Your Payment Methods
Edit your `.env` file and add your payment details:

**Fiat Payments:**
```env
STRIPE_PAYMENT_LINK=https://buy.stripe.com/your-link
PAYPAL_PAYMENT_LINK=https://paypal.me/yourusername
VENMO_USERNAME=yourusername
CASHAPP_TAG=yourusername
ZELLE_EMAIL=your@email.com
```

**Cryptocurrency:**
```env
BTC_ADDRESS=bc1q...
ETH_ADDRESS=0x...
USDC_ADDRESS=0x...
SOL_ADDRESS=...
LTC_ADDRESS=ltc1q...
```

### 3. Routes Added
The system is automatically integrated at `/payments`

## Usage

### Main Payment Page
Visit `/payments` to see all configured payment options:
- Featured methods displayed in a prominent grid
- All methods organized by type (fiat/crypto)
- Responsive design for mobile payments

### Individual Payment Method
Visit `/payments/method/{type}/{id}` for detailed payment info:
- **Crypto**: Shows wallet address, QR code, network info, and warnings
- **Fiat**: Shows fees and direct payment link

### API Endpoints

**Get All Payment Methods:**
```
GET /payments/api/methods
```
Returns JSON with all enabled payment methods

**Get QR Code Data:**
```
GET /payments/api/qr/crypto/{id}
```
Returns crypto address details for QR generation

## Payment Method Configuration

Each payment method has:
- `id`: Unique identifier
- `name`: Display name
- `icon`: Emoji/symbol
- `description`: Brief explanation
- `featured`: Boolean (highlighted on main page)
- `enabled`: Boolean (show/hide method)
- `fees`: Transaction fees (fiat)
- `network`: Blockchain network (crypto)
- `address`: Wallet address (crypto)

## Customization

Edit `/srv/madladslab/routes/payments/index.js` to:
- Add new payment methods
- Change featured methods
- Modify fee structures
- Update descriptions and icons

## Security Notes

### Fiat Payments
- Links redirect to official payment processors
- No sensitive data stored locally
- Fees displayed for transparency

### Cryptocurrency
- Addresses are public (safe to display)
- Network verification warnings shown
- QR codes generated client-side
- Users advised to verify addresses before sending

## Navigation

Payment link added to:
- Admin sidebar (accessible to all users)
- Direct URL: `/payments`

## Dependencies

- **QR Code Generation**: CDN-loaded qrcode.js library (for crypto payments)
- **Express**: Routing and middleware
- **EJS**: Template rendering

## Files Structure

```
routes/payments/
├── index.js          # Payment routes and configuration
└── README.md         # This file

views/payments/
├── index.ejs         # Main payment page
└── method.ejs        # Individual payment method detail

.env.payments.example # Environment variable template
```

## Future Enhancements

- [ ] Payment amount specification
- [ ] Transaction tracking
- [ ] Email notifications
- [ ] Payment history/receipts
- [ ] Multi-currency support
- [ ] Dynamic fee calculation
- [ ] Webhook integrations
- [ ] Invoice generation

## Support

For issues or feature requests, contact the development team.
