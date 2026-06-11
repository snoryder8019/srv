// templates.js — curated catalog of reusable view-module templates for the
// Left Field pitch editor.
//
// Free users do NOT write code or invent view types. They pick from this
// catalog and the editor drops a fresh, well-formed `views[]` entry into their
// pitch — pre-filled with realistic-but-generic PLACEHOLDER data so the chart
// renders immediately. Every `slug` here MUST match a recognized view slug the
// renderer knows how to draw (see views/pitch.ejs + public/js/view-*.js).
//
// Each catalog entry:
//   { slug, title, description, kind, scaffold }
// where `scaffold` is a function returning a complete `views[]` entry object
// matching the renderer schema (slug, title, subtitle, [controls], [data],
// scope[]). Scaffolds are pure — call them fresh each time so two views built
// from the same template don't share object references.
//
// `kind` is a coarse renderer family used only for grouping in the picker UI:
//   'chartjs' | 'echarts' | 'd3' | 'content'

const rateNote = (hours, rate, mult = 3) => ({
  hours,
  cost: Math.round(hours * rate),
  firmCost: Math.round(hours * rate * mult),
});

/** Build a scope item with auto-computed MLL + firm cost from hours × rate. */
export function scopeItem(id, title, description, hours, rate = 75, firmMult = 3) {
  return { id, title, description, ...rateNote(hours, rate, firmMult) };
}

// ── catalog entries ──────────────────────────────────────────────────────────
// Each scaffold returns a self-contained view entry. `rate` defaults to 75 so
// scope costs line up with the pitch defaultRate; the editor passes the pitch's
// own rate so costs stay consistent.

export const CATALOG = [
  {
    slug: 'quality-of-revenue',
    title: 'Quality of Revenue',
    description: 'Recurring vs. one-time revenue with a retention overlay and mix-shift cuts. Chart.js stacked/grouped bars — the first thing buyers and lenders look at.',
    kind: 'chartjs',
    scaffold: (rate = 75) => ({
      slug: 'quality-of-revenue',
      title: 'Quality of Revenue',
      subtitle: 'Recurring vs. one-time revenue, retention overlay, and mix shift by product / customer / geography.',
      controls: {
        variants: [
          { id: 'stacked', label: 'Stacked bar + retention line' },
          { id: 'grouped', label: 'Grouped bars + mix doughnut' },
        ],
        views: [
          { id: 'combined', label: 'Combined (recurring + one-time)' },
          { id: 'by-product', label: 'By product line' },
          { id: 'by-customer', label: 'By customer cohort' },
          { id: 'by-geo', label: 'By geography' },
        ],
        dateRanges: [
          { id: 'ttm', label: 'Trailing 12 months' },
          { id: '3y', label: 'Last 3 years' },
        ],
        numberVariables: [
          { id: 'retentionAdj', label: 'Retention adj (pts)', default: 0, min: -20, max: 20, step: 1 },
        ],
      },
      data: {
        periods: ["Q1'24", "Q2'24", "Q3'24", "Q4'24", "Q1'25", "Q2'25", "Q3'25", "Q4'25", "Q1'26"],
        recurring: [420000, 460000, 500000, 540000, 590000, 640000, 700000, 760000, 820000],
        oneTime: [120000, 140000, 110000, 160000, 130000, 150000, 120000, 170000, 140000],
        retention: [98, 100, 101, 103, 105, 107, 108, 110, 112],
        dateRanges: { ttm: 4, '3y': 9 },
        viewSplits: {
          'by-product': [
            { name: 'Core product', weight: 0.5, color: '#7c5cff' },
            { name: 'Add-on', weight: 0.3, color: '#34d6c2' },
            { name: 'Services', weight: 0.2, color: '#ffb547' },
          ],
          'by-customer': [
            { name: 'Enterprise', weight: 0.55, color: '#7c5cff' },
            { name: 'Mid-market', weight: 0.3, color: '#34d6c2' },
            { name: 'SMB', weight: 0.15, color: '#ffb547' },
          ],
          'by-geo': [
            { name: 'North America', weight: 0.6, color: '#7c5cff' },
            { name: 'EMEA', weight: 0.28, color: '#34d6c2' },
            { name: 'APAC', weight: 0.12, color: '#ffb547' },
          ],
        },
      },
      scope: [
        scopeItem('qor.ingest', 'Revenue data ingest', 'Headless XLSX/CSV reader with schema mapping for revenue tabs.', 9, rate),
        scopeItem('qor.cohort', 'Cohort retention model', 'Customer cohorts, churn/upsell waterfall, NRR/GRR computation.', 12, rate),
        scopeItem('qor.mix', 'Mix-shift report builder', 'Pivot by product / customer / geo with CSV + PDF export.', 7, rate),
      ],
    }),
  },

  {
    slug: 'nwc',
    title: 'Net Working Capital',
    description: 'AR / AP / Inventory roll plus a peg-band actual line. ECharts waterfall + treemap — the number that closes the deal at signing.',
    kind: 'echarts',
    scaffold: (rate = 75) => ({
      slug: 'nwc',
      title: 'Net Working Capital',
      subtitle: 'AR / AP / Inventory roll against a configurable peg band — what closes the deal at signing.',
      controls: {
        variants: [
          { id: 'waterfall', label: 'Waterfall + peg band' },
          { id: 'treemap', label: 'Treemap + monthly heatmap' },
        ],
        dateRanges: [
          { id: 'ttm', label: 'TTM' },
          { id: 'ytd', label: 'YTD' },
        ],
        numberVariables: [
          { id: 'dso', label: 'Target DSO', default: 45, min: 10, max: 120, step: 1 },
          { id: 'dpo', label: 'Target DPO', default: 38, min: 10, max: 120, step: 1 },
        ],
      },
      data: {
        months: ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May'],
        ar: [320000, 340000, 360000, 370000, 380000, 400000, 410000, 430000, 450000, 470000, 490000],
        ap: [180000, 190000, 200000, 205000, 210000, 220000, 230000, 235000, 245000, 255000, 265000],
        inventory: [140000, 150000, 160000, 165000, 170000, 180000, 190000, 195000, 205000, 215000, 225000],
        pegHigh: [360000, 370000, 380000, 395000, 405000, 420000, 435000, 450000, 470000, 490000, 510000],
        pegLow: [300000, 310000, 320000, 330000, 340000, 355000, 370000, 385000, 400000, 420000, 440000],
        actual: [330000, 345000, 360000, 375000, 390000, 405000, 420000, 435000, 455000, 475000, 495000],
        dateRanges: { ttm: 11, ytd: 5 },
        baselineDSO: 45,
        baselineDPO: 38,
      },
      scope: [
        scopeItem('nwc.peg', 'Peg calculator', 'Configurable TTM average peg with adjustments + lock-up.', 8, rate),
        scopeItem('nwc.audit', 'Cell-level audit trail', 'Every NWC number traces to a source doc + reviewer signoff.', 11, rate),
      ],
    }),
  },

  {
    slug: 'trend-forecast',
    title: 'Trend & Forecasting',
    description: 'Historical actuals plus a forecast cone with scenario knobs. Brushable D3 for ad-hoc windows the team will want to pin and compare.',
    kind: 'd3',
    scaffold: (rate = 75) => ({
      slug: 'trend-forecast',
      title: 'Trend & Forecasting',
      subtitle: 'Historical actuals + a forecast cone you can stress with a growth knob. Brushable for ad-hoc windows.',
      controls: {
        variants: [
          { id: 'cone', label: 'Forecast cone (line + band)' },
          { id: 'stream', label: 'Brushable stream' },
        ],
        views: [
          { id: 'revenue', label: 'Revenue' },
          { id: 'gross-margin', label: 'Gross margin' },
          { id: 'ebitda', label: 'EBITDA' },
        ],
        dateRanges: [
          { id: '3y', label: '3 years' },
          { id: '5y', label: '5 years' },
        ],
        numberVariables: [
          { id: 'growthAdj', label: 'Forecast growth adj (%)', default: 0, min: -50, max: 50, step: 1 },
        ],
      },
      data: {
        historical: [
          { period: '2024-01', value: 220000, kind: 'actual' },
          { period: '2024-04', value: 240000, kind: 'actual' },
          { period: '2024-07', value: 260000, kind: 'actual' },
          { period: '2024-10', value: 285000, kind: 'actual' },
          { period: '2025-01', value: 305000, kind: 'actual' },
          { period: '2025-04', value: 330000, kind: 'actual' },
          { period: '2025-07', value: 360000, kind: 'actual' },
          { period: '2025-10', value: 390000, kind: 'actual' },
          { period: '2026-01', value: 420000, kind: 'actual' },
          { period: '2026-04', value: 455000, kind: 'actual' },
        ],
        forecast: [
          { period: '2026-07', value: 485000, low: 460000, high: 510000, kind: 'forecast' },
          { period: '2026-10', value: 520000, low: 485000, high: 555000, kind: 'forecast' },
          { period: '2027-01', value: 560000, low: 515000, high: 605000, kind: 'forecast' },
          { period: '2027-04', value: 600000, low: 545000, high: 655000, kind: 'forecast' },
        ],
        metricMultipliers: {
          revenue: { value: 1.0, label: 'Revenue', color: '#34d6c2' },
          'gross-margin': { value: 0.62, label: 'Gross margin', color: '#7c5cff' },
          ebitda: { value: 0.24, label: 'EBITDA', color: '#ffb547' },
        },
        dateThresholds: { '3y': '2024-07', '5y': '2024-01' },
      },
      scope: [
        scopeItem('trend.bands', 'Forecast band engine', 'Monte Carlo + scenario knobs, exported to PDF and slide deck.', 13, rate),
        scopeItem('trend.brush', 'Brushable comparison', 'Pin two windows, compare deltas, share a permalink.', 5, rate),
      ],
    }),
  },

  {
    slug: 'data-room',
    title: 'Data Room',
    description: 'Permissioned folders, multi-party invites, watermarking, and an audit log. Operator dashboard + folder grid for diligence and verification.',
    kind: 'content',
    scaffold: (rate = 75) => ({
      slug: 'data-room',
      title: 'Data Room',
      subtitle: 'Permissioned folders, multi-party invites, watermarking, and a full audit log.',
      controls: {
        variants: [
          { id: 'dashboard', label: 'Operator dashboard' },
          { id: 'grid', label: 'Folder grid' },
        ],
      },
      data: {
        stats: { totalDocs: 64, ready: 28, pending: 30, blocked: 6, activeViewers: 9, uploadsWeek: 14 },
        activity: [
          { ts: '2026-06-04T13:42:00Z', actor: 'Buyer · J. Lin', action: 'viewed', file: 'Cap table v2.xlsx', folder: '01 · Corporate' },
          { ts: '2026-06-04T11:18:00Z', actor: 'Seller · M. Cho', action: 'uploaded', file: 'Financials 2025.pdf', folder: '02 · Financial' },
          { ts: '2026-06-03T16:55:00Z', actor: 'Counsel · R. Patel', action: 'downloaded', file: 'Contracts.zip', folder: '03 · Commercial' },
          { ts: '2026-06-03T10:30:00Z', actor: 'Reviewer · A. Singh', action: 'blocked', file: 'Security memo.pdf', folder: '04 · Tech' },
          { ts: '2026-06-02T09:12:00Z', actor: 'Buyer · J. Lin', action: 'commented', file: 'Customer list.csv', folder: '03 · Commercial' },
        ],
        folders: [
          {
            name: '01 · Corporate', docs: 12, access: 'All buyers', status: 'ready',
            items: [
              { name: 'Cap table v2.xlsx', roles: ['buyer', 'counsel'] },
              { name: 'Articles of incorporation.pdf', roles: ['buyer', 'counsel'] },
            ],
          },
          {
            name: '02 · Financial', docs: 24, access: 'Buyer + Lender', status: 'pending',
            items: [
              { name: 'Financials 2025.pdf', roles: ['buyer', 'lender'] },
              { name: 'Monthly P&L.zip', roles: ['buyer'] },
            ],
          },
          {
            name: '03 · Commercial', docs: 18, access: 'Buyer only', status: 'ready',
            items: [
              { name: 'Customer list.csv', roles: ['buyer'] },
              { name: 'Contracts.zip', roles: ['counsel'] },
            ],
          },
          {
            name: '04 · Tech', docs: 10, access: 'Tech diligence', status: 'blocked',
            items: [
              { name: 'Architecture overview.pdf', roles: ['techdd'] },
              { name: 'Security memo.pdf', roles: ['techdd', 'counsel'] },
            ],
          },
        ],
      },
      scope: [
        scopeItem('dr.invites', 'Multi-party invite flows', 'Magic-link onboarding for buyers, counsel, lenders. Per-folder, expiring grants.', 10, rate),
        scopeItem('dr.watermark', 'Dynamic watermarking', 'Per-viewer watermark on PDF preview + downloads.', 6, rate),
        scopeItem('dr.audit', 'Audit log + export', 'Who-viewed-what, with CSV/PDF export for compliance.', 7, rate),
      ],
    }),
  },

  {
    slug: 'team-workflow',
    title: 'Team Workflow',
    description: 'A staged pipeline from kickoff to delivery, with owners, SLAs, and a throughput chart showing where time is lost today. Chart.js bars / radar.',
    kind: 'chartjs',
    scaffold: (rate = 75) => ({
      slug: 'team-workflow',
      title: 'Team Workflow',
      subtitle: 'The full delivery flow with owners, SLAs, and a throughput chart that shows where time is lost today.',
      controls: {
        variants: [
          { id: 'bar-h', label: 'Horizontal bars (current vs target)' },
          { id: 'radar', label: 'Radar (current vs target)' },
        ],
      },
      data: {
        nodes: [
          { id: 'intake', name: 'Intake', owner: 'Lead', sla: 'Day 0', completion: 100, completed: ['Brief received', 'Team assigned'], needed: [] },
          { id: 'kickoff', name: 'Kickoff', owner: 'Lead', sla: 'Day 3', completion: 80, completed: ['Kickoff call held', 'Access provisioned'], needed: ['Scope locked'] },
          { id: 'build', name: 'Build', owner: 'Operator', sla: 'Wk 1', completion: 55, completed: ['Schema modeled', 'First view shipped'], needed: ['Remaining views', 'Review pass'] },
          { id: 'review', name: 'Review', owner: 'Reviewer', sla: 'Wk 2', completion: 25, completed: ['First review done'], needed: ['Sign-off sweep', 'Exception list'] },
          { id: 'verify', name: 'Verification', owner: 'Reviewer', sla: 'Wk 3', completion: 0, completed: [], needed: ['Source tie-out', 'Final read'] },
          { id: 'delivery', name: 'Delivery', owner: 'Lead', sla: 'Wk 4', completion: 0, completed: [], needed: ['Handoff doc', 'Walkthrough call'] },
        ],
        throughput: {
          stages: ['Kickoff', 'Build', 'Review', 'Verification', 'Delivery'],
          currentDays: [4, 12, 8, 9, 6],
          targetDays: [2, 8, 4, 5, 3],
        },
      },
      scope: [
        scopeItem('wf.stages', 'Configurable stages + SLAs', 'Define stages per engagement, with SLAs, owners, and auto-reminders.', 9, rate),
        scopeItem('wf.handoff', 'Cross-team handoff', 'Structured handoffs with checklists between teams.', 7, rate),
        scopeItem('wf.client', 'Client-facing tracker', 'Read-only client portal with status, blockers, ETA.', 8, rate),
      ],
    }),
  },

  {
    slug: 'packages',
    title: 'Monthly Packages',
    description: 'Side-by-side monthly tiers with features, what is and is not included, and firm-vs-MLL pricing. Reads the pitch-level packages[] you fill in.',
    kind: 'content',
    scaffold: (rate = 75) => ({
      slug: 'packages',
      title: 'Monthly Packages',
      subtitle: 'Pick a tier. Each one runs on a published schedule. Compare side-by-side — see what is in and what is not.',
      scope: [
        scopeItem('pkg.starter', 'Starter · onboarding + month 1', 'Setup, first schedule, first deliverable. Billed monthly thereafter.', 12, rate),
        scopeItem('pkg.growth', 'Growth · onboarding + month 1', 'All Starter, plus expanded cadence and reporting. Billed monthly thereafter.', 22, rate),
        scopeItem('pkg.scale', 'Scale · onboarding + month 1', 'All Growth, plus full-stack ops and campaigns. Billed monthly thereafter.', 38, rate),
      ],
    }),
  },

  {
    slug: 'marketing',
    title: 'Marketing · Lead Funnel',
    description: 'ECharts funnel, source mix, and a 90-day campaign view. Reads the pitch-level marketing{} block (KPIs, funnel, sources, campaign) you fill in.',
    kind: 'echarts',
    scaffold: (rate = 75) => ({
      slug: 'marketing',
      title: 'Marketing · Lead Funnel',
      subtitle: 'What a month actually moves — funnel, source mix, and the 90-day campaign view your monthly report sits on top of.',
      scope: [
        scopeItem('mk.attribution', 'Source attribution wiring', 'Tag every session, call, and form fill with its source (paid, organic, referral).', 9, rate),
        scopeItem('mk.adspend', 'Ad spend management', 'Campaign setup, weekly tuning, creative rotation. Flat fee, no % of spend.', 10, rate),
        scopeItem('mk.review-loop', 'Review request loop', 'Auto-prompt past customers for reviews after delivery. SMS optional.', 6, rate),
        scopeItem('mk.email', 'Email + SMS campaigns', 'Past-customer segmentation, monthly send, ROI tracking back in admin.', 7, rate),
      ],
    }),
  },
];

// ── lookup helpers ───────────────────────────────────────────────────────────
const BY_SLUG = new Map(CATALOG.map((t) => [t.slug, t]));

/** The set of catalog slugs (recognized, editor-offered view modules). */
export const TEMPLATE_SLUGS = CATALOG.map((t) => t.slug);

/** Catalog entry for a slug, or undefined. */
export function getTemplate(slug) {
  return BY_SLUG.get(slug);
}

/** True if a slug is a known catalog template. */
export function isTemplateSlug(slug) {
  return BY_SLUG.has(slug);
}

/**
 * Build a fresh, well-formed views[] entry for a catalog slug.
 * Returns null for unknown slugs. `rate` flows into scope cost computation.
 */
export function scaffoldFor(slug, rate = 75) {
  const tpl = BY_SLUG.get(slug);
  if (!tpl) return null;
  return typeof tpl.scaffold === 'function' ? tpl.scaffold(rate) : { ...tpl.scaffold };
}

/** Picker-friendly catalog (no scaffold fn) for rendering in views. */
export function catalogList() {
  return CATALOG.map(({ slug, title, description, kind }) => ({ slug, title, description, kind }));
}

export default CATALOG;
