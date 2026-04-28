import express from 'express';
import { config } from '../config/config.js';

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', {
    user: req.user || null,
    priceCents: config.PRODUCT_PRICE_CENTS,
    trialDays: config.TRIAL_DAYS,
  });
});

router.get('/pricing', (req, res) => {
  res.render('pricing', {
    user: req.user || null,
    priceCents: config.PRODUCT_PRICE_CENTS,
    trialDays: config.TRIAL_DAYS,
    paypalEnabled: config.paypalEnabled(),
    stripeEnabled: config.stripeEnabled(),
  });
});

export default router;
