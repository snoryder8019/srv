import express from 'express';
import { ObjectId } from 'mongodb';
import QRCode from 'qrcode';

const router = express.Router();

// ── Helper: get all QR links for this tenant ──
async function getQrLinks(db) {
  return db.collection('qr_links').find({}).sort({ createdAt: -1 }).toArray();
}

// ── Helper: gather every linkable destination on this tenant ──
// Returns groups of { label, url } the admin can point a QR at, so they pick
// a real page/post/form instead of typing a URL by hand.
async function getDestinations(db, domain) {
  const base = `https://${domain}`;
  const [pages, posts, portfolio, forms] = await Promise.all([
    db.collection('pages').find({ status: 'published' }).project({ title: 1, slug: 1 }).sort({ title: 1 }).toArray(),
    db.collection('blog').find({ status: 'published', contentType: { $in: ['blog', null] } }).project({ title: 1, slug: 1 }).sort({ publishedAt: -1 }).toArray(),
    db.collection('portfolio').find({ status: { $ne: 'draft' } }).project({ title: 1 }).limit(1).toArray(),
    db.collection('onboarding_forms').find({ status: 'active' }).project({ name: 1, slug: 1 }).sort({ name: 1 }).toArray(),
  ]);

  const groups = [];
  if (pages.length) {
    groups.push({ group: 'Pages', items: pages.map(p => ({ label: p.title || p.slug, url: `${base}/${p.slug}` })) });
  }
  if (posts.length) {
    groups.push({ group: 'Blog Posts', items: posts.map(p => ({ label: p.title || p.slug, url: `${base}/blog/${p.slug}` })) });
  }
  if (portfolio.length) {
    groups.push({ group: 'Portfolio', items: [{ label: 'Portfolio Section', url: `${base}/#portfolio` }] });
  }
  if (forms.length) {
    groups.push({ group: 'Forms', items: forms.map(f => ({ label: f.name || f.slug, url: `${base}/forms/${f.slug}` })) });
  }
  return groups;
}

// ── List all QR links + business card config ──
router.get('/', async (req, res) => {
  try {
    const db = req.db;
    const domain = req.hostname;
    const [links, destinations] = await Promise.all([
      getQrLinks(db),
      getDestinations(db, domain),
    ]);
    const brand = req.tenant?.brand || {};

    // Load logo for card preview
    const logoRow = await db.collection('brand_images').findOne({ slot: 'logo_primary' });
    const logo = logoRow?.url || '';

    res.render('admin/qrcodes', {
      user: req.adminUser,
      page: 'qr-codes',
      title: 'QR Codes & Business Card',
      links,
      destinations,
      brand,
      domain,
      logo,
      saved: req.query.saved === '1',
      error: req.query.error || null,
    });
  } catch (err) {
    console.error('[QR] list error:', err);
    res.redirect('/admin?error=qr');
  }
});

// ── Create new QR link ──
router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const { label, url, type, slug, destination } = req.body;
    if (!label || !label.trim()) return res.redirect('/admin/qr-codes?error=label');

    const cleanSlug = (slug || label).trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Check slug uniqueness
    const exists = await db.collection('qr_links').findOne({ slug: cleanSlug });
    if (exists) return res.redirect('/admin/qr-codes?error=slug');

    const domain = req.hostname;

    // The "destination" dropdown is the primary control. Special values pick a
    // mode; any other value is a fully-built target URL chosen from the tenant's
    // own pages/posts/forms. Fall back to the legacy `type`/`url` fields.
    let linkType;
    let targetUrl = url?.trim() || '';

    if (destination === 'business-card' || type === 'business-card') {
      linkType = 'business-card';
      targetUrl = `https://${domain}/card/${cleanSlug}`;
    } else if (destination === 'custom' || (!destination && type === 'custom')) {
      linkType = 'custom';
      if (!targetUrl) targetUrl = `https://${domain}`;
    } else if (destination) {
      linkType = 'link';
      targetUrl = destination.trim();
    } else {
      linkType = type || 'custom';
      if (!targetUrl) targetUrl = `https://${domain}`;
    }

    await db.collection('qr_links').insertOne({
      label: label.trim(),
      type: linkType,
      url: targetUrl,
      slug: cleanSlug,
      showInFooter: false,
      scanCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`[QR] Created link: "${label.trim()}" → ${targetUrl}`);
    res.redirect('/admin/qr-codes?saved=1');
  } catch (err) {
    console.error('[QR] create error:', err);
    res.redirect('/admin/qr-codes?error=create');
  }
});

// ── Toggle footer display ──
router.post('/:id/footer', async (req, res) => {
  try {
    const db = req.db;
    const link = await db.collection('qr_links').findOne({ _id: new ObjectId(req.params.id) });
    if (!link) return res.redirect('/admin/qr-codes?error=notfound');

    await db.collection('qr_links').updateOne(
      { _id: link._id },
      { $set: { showInFooter: !link.showInFooter, updatedAt: new Date() } },
    );
    res.redirect('/admin/qr-codes?saved=1');
  } catch (err) {
    console.error('[QR] footer toggle error:', err);
    res.redirect('/admin/qr-codes?error=1');
  }
});

// ── Update QR link ──
router.post('/:id/update', async (req, res) => {
  try {
    const db = req.db;
    const { label, url } = req.body;
    const update = { updatedAt: new Date() };
    if (label) update.label = label.trim();
    if (url) update.url = url.trim();

    await db.collection('qr_links').updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
    );
    res.redirect('/admin/qr-codes?saved=1');
  } catch (err) {
    console.error('[QR] update error:', err);
    res.redirect('/admin/qr-codes?error=1');
  }
});

// ── Delete QR link ──
router.post('/:id/delete', async (req, res) => {
  try {
    const db = req.db;
    await db.collection('qr_links').deleteOne({ _id: new ObjectId(req.params.id) });
    res.redirect('/admin/qr-codes?saved=1');
  } catch (err) {
    console.error('[QR] delete error:', err);
    res.redirect('/admin/qr-codes?error=1');
  }
});

// ── API: generate QR code as data URL (for admin preview + download) ──
router.get('/:id/qr.png', async (req, res) => {
  try {
    const db = req.db;
    const link = await db.collection('qr_links').findOne({ _id: new ObjectId(req.params.id) });
    if (!link) return res.status(404).json({ error: 'Not found' });

    const design = {};
    const rows = await db.collection('design').find({ key: { $in: ['color_primary', 'color_white'] } }).toArray();
    for (const r of rows) design[r.key] = r.value;

    const png = await QRCode.toBuffer(link.url, {
      width: 512,
      margin: 2,
      color: {
        dark: design.color_primary || '#1C2B4A',
        light: design.color_white || '#FFFFFF',
      },
    });

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `inline; filename="${link.slug}-qr.png"`);
    res.send(png);
  } catch (err) {
    console.error('[QR] png error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── API: get QR data URL (JSON) ──
router.get('/:id/qr.json', async (req, res) => {
  try {
    const db = req.db;
    const link = await db.collection('qr_links').findOne({ _id: new ObjectId(req.params.id) });
    if (!link) return res.status(404).json({ error: 'Not found' });

    const design = {};
    const rows = await db.collection('design').find({ key: { $in: ['color_primary'] } }).toArray();
    for (const r of rows) design[r.key] = r.value;

    const dataUrl = await QRCode.toDataURL(link.url, {
      width: 300,
      margin: 2,
      color: { dark: design.color_primary || '#1C2B4A', light: '#ffffff' },
    });

    res.json({ url: link.url, dataUrl, label: link.label });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
