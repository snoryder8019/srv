/**
 * Slab — Analytics Admin Module
 * GET  /admin/analytics            → analytics page (view)
 * GET  /admin/analytics/metrics    → aggregated metrics JSON (day|week|month)
 * POST /admin/analytics/agent      → scoped analytics agent (read-only)
 */

import express from 'express';
import { runTool } from '../../plugins/agentMcp.js';
import { loadBrandContext } from '../../plugins/brandContext.js';

const router = express.Router();

const RANGE_DAYS = { day: 1, week: 7, month: 30 };

async function buildMetrics(db, range) {
  const days = RANGE_DAYS[range] || 1;
  const since = new Date(Date.now() - days * 86400000);
  const c = (name) => db.collection(name);
  const safe = (p) => p.catch(() => 0);
  const safeArr = (p) => p.catch(() => []);
  const cd = (name, q) => safe(c(name).countDocuments(q));

  const [
    blogNew, pagesNew, sectionsNew, portfolioNew, assetsNew,
    campaignsNew, campaignsSent, contactsNew, contactsTotal, contactsSubscribed,
    invoicesNew, invoicesPaid, invoicesOverdue, invoicesUnpaid,
    paidAggArr,
    clientsNew, clientsTotal, meetingsNew, inquiriesNew, ticketsOpen, ticketsNew,
    emailOpens, emailClicks, emailBounces, emailUnsubs, emailInbound,
    onboardingNew, onboardingResponses,
    topCampaignsArr, topBlogArr,
  ] = await Promise.all([
    cd('blog',              { createdAt: { $gte: since } }),
    cd('pages',             { createdAt: { $gte: since } }),
    cd('custom_sections',   { createdAt: { $gte: since } }),
    cd('portfolio',         { createdAt: { $gte: since } }),
    cd('assets',            { uploadedAt: { $gte: since } }),
    cd('campaigns',         { createdAt: { $gte: since } }),
    cd('campaigns',         { sentAt:    { $gte: since } }),
    cd('contacts',          { createdAt: { $gte: since } }),
    cd('contacts',          {}),
    cd('contacts',          { status: 'subscribed' }),
    cd('invoices',          { createdAt: { $gte: since } }),
    cd('invoices',          { status: 'paid', updatedAt: { $gte: since } }),
    cd('invoices',          { status: 'overdue' }),
    cd('invoices',          { status: { $in: ['unpaid', 'sent'] } }),
    safeArr(c('invoices').aggregate([
      { $match: { status: 'paid', updatedAt: { $gte: since } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]).toArray()),
    cd('clients',           { createdAt: { $gte: since } }),
    cd('clients',           {}),
    cd('meetings',          { createdAt: { $gte: since } }),
    cd('inquiries',         { createdAt: { $gte: since } }),
    cd('tickets',           { status: { $in: ['open', 'in-progress', 'escalated'] } }),
    cd('tickets',           { createdAt: { $gte: since } }),
    cd('campaign_events',   { type: 'open',        ts: { $gte: since } }),
    cd('campaign_events',   { type: 'click',       ts: { $gte: since } }),
    cd('campaign_events',   { type: 'bounce',      ts: { $gte: since } }),
    cd('campaign_events',   { type: 'unsubscribe', ts: { $gte: since } }),
    cd('campaign_events',   { type: 'inbound',     ts: { $gte: since } }),
    cd('onboarding_forms',  { createdAt: { $gte: since } }),
    cd('onboarding_responses', { createdAt: { $gte: since } }),
    safeArr(c('campaigns')
      .find({ sentAt: { $gte: since } })
      .sort({ sentCount: -1 })
      .limit(5)
      .project({ subject: 1, sentCount: 1, sentAt: 1, targetFunnel: 1 })
      .toArray()),
    safeArr(c('blog')
      .find({ createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(5)
      .project({ title: 1, slug: 1, status: 1, createdAt: 1 })
      .toArray()),
  ]);

  const revenuePaid = paidAggArr?.[0]?.total || 0;

  return {
    range,
    since: since.toISOString(),
    content: { blogNew, pagesNew, sectionsNew, portfolioNew, assetsNew },
    email:   { campaignsNew, campaignsSent, emailOpens, emailClicks, emailBounces, emailUnsubs, emailInbound,
               openRate:  campaignsSent > 0 ? +(emailOpens  / Math.max(1, campaignsSent * 10) * 100).toFixed(1) : 0,
               clickRate: campaignsSent > 0 ? +(emailClicks / Math.max(1, campaignsSent * 10) * 100).toFixed(1) : 0 },
    revenue: { invoicesNew, invoicesPaid, invoicesOverdue, invoicesUnpaid, revenuePaid },
    audience:{ contactsNew, contactsTotal, contactsSubscribed, clientsNew, clientsTotal },
    operations: { meetingsNew, inquiriesNew, ticketsOpen, ticketsNew, onboardingNew, onboardingResponses },
    top: { campaigns: topCampaignsArr, blogPosts: topBlogArr },
  };
}

// GET /admin/analytics — render page
router.get('/', async (req, res) => {
  try {
    const range = ['day', 'week', 'month'].includes(req.query.range) ? req.query.range : 'week';
    const metrics = await buildMetrics(req.db, range);
    res.render('admin/analytics/index', {
      user: req.adminUser,
      page: 'analytics',
      title: 'Analytics',
      range,
      metrics,
    });
  } catch (err) {
    console.error('[analytics] page error:', err);
    res.status(500).send('Failed to load analytics.');
  }
});

// GET /admin/analytics/metrics — JSON
router.get('/metrics', async (req, res) => {
  try {
    const range = ['day', 'week', 'month'].includes(req.query.range) ? req.query.range : 'week';
    const metrics = await buildMetrics(req.db, range);
    res.json(metrics);
  } catch (err) {
    console.error('[analytics] metrics error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /admin/analytics/agent — scoped to analytics only (read-only)
router.post('/agent', express.json(), async (req, res) => {
  try {
    const range = ['day', 'week', 'month'].includes(req.body.range) ? req.body.range : 'week';
    const question = (req.body.question || req.body.prompt || 'Summarize how the business is doing').slice(0, 500);
    const metrics = await buildMetrics(req.db, range);
    const brandContext = await loadBrandContext(req.tenant, req.db);

    const parsed = await runTool('analyze_metrics', { question, metrics, range, brandContext });
    res.json({
      success: true,
      message: parsed.message || 'Analysis ready.',
      report:  parsed.fill || {},
      metrics,
      range,
    });
  } catch (err) {
    console.error('[analytics] agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

export { buildMetrics };
export default router;
