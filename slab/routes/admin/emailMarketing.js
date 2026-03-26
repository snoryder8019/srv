import express from 'express';
import { ObjectId } from 'mongodb';
import multer from 'multer';
import { getDb } from '../../plugins/mongo.js';
import { sendCampaignEmail } from '../../plugins/mailer.js';
import { config } from '../../config/config.js';
import { webSearch, callLLM, tryParseAgentResponse } from '../../plugins/agentMcp.js';
import { buildBrandContext } from '../../plugins/brandContext.js';

const router = express.Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── Dashboard ──
router.get('/', async (req, res) => {
  const db = req.db;
  const tab = req.query.tab || 'contacts';

  const [contacts, campaigns, clients, campaignEvents] = await Promise.all([
    db.collection('contacts').find({}).sort({ createdAt: -1 }).toArray(),
    db.collection('campaigns').find({}).sort({ createdAt: -1 }).toArray(),
    db.collection('clients').find({}).project({ name: 1, email: 1, status: 1 }).toArray(),
    db.collection('campaign_events').aggregate([
      { $group: { _id: { campaignId: '$campaignId', type: '$type' }, total: { $sum: 1 }, unique: { $addToSet: '$contactId' } } },
      { $project: { _id: 1, total: 1, unique: { $size: '$unique' } } },
    ]).toArray(),
  ]);

  // Build analytics lookup map
  const analyticsMap = {};
  for (const evt of campaignEvents) {
    const cid = evt._id.campaignId.toString();
    if (!analyticsMap[cid]) analyticsMap[cid] = {};
    analyticsMap[cid][evt._id.type] = { total: evt.total, unique: evt.unique };
  }

  // Stats
  const totalContacts = contacts.length;
  const subscribedContacts = contacts.filter(c => c.status === 'subscribed').length;
  const totalCampaigns = campaigns.length;
  const sentCampaigns = campaigns.filter(c => c.status === 'sent').length;

  // Funnel breakdown
  const funnelCounts = { lead: 0, prospect: 0, customer: 0, churned: 0 };
  for (const c of contacts) funnelCounts[c.funnel || 'lead']++;

  res.render('admin/email-marketing/index', {
    user: req.adminUser,
    tab,
    contacts,
    campaigns,
    clients,
    analyticsMap,
    stats: { totalContacts, subscribedContacts, totalCampaigns, sentCampaigns },
    funnelCounts,
    qs: req.query,
  });
});

// ── Add single contact ──
router.post('/contacts', async (req, res) => {
  try {
    const db = req.db;
    const { email, name, funnel, source, tags } = req.body;
    if (!email) return res.redirect('/admin/email-marketing?tab=contacts&error=Email+required');

    const existing = await db.collection('contacts').findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.redirect('/admin/email-marketing?tab=contacts&error=Contact+already+exists');

    await db.collection('contacts').insertOne({
      email: email.toLowerCase().trim(),
      name: name || '',
      funnel: funnel || 'lead',
      source: source || 'manual',
      tags: tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      status: 'subscribed',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.redirect('/admin/email-marketing?tab=contacts&success=Contact+added');
  } catch (err) {
    console.error('Add contact error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=Failed+to+add+contact');
  }
});

// ── CSV upload ──
router.post('/contacts/upload', csvUpload.single('csv'), async (req, res) => {
  try {
    const db = req.db;
    if (!req.file) return res.redirect('/admin/email-marketing?tab=contacts&error=No+file+uploaded');

    const text = req.file.buffer.toString('utf8');
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return res.redirect('/admin/email-marketing?tab=contacts&error=CSV+is+empty');

    // Parse header
    const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g, ''));
    const emailIdx = header.findIndex(h => h === 'email' || h === 'e-mail' || h === 'email address');
    const nameIdx = header.findIndex(h => h === 'name' || h === 'full name' || h === 'fullname');
    const tagsIdx = header.findIndex(h => h === 'tags' || h === 'tag');

    if (emailIdx === -1) return res.redirect('/admin/email-marketing?tab=contacts&error=CSV+must+have+an+email+column');

    const funnel = req.body.funnel || 'lead';
    const source = req.body.source || 'csv-upload';
    let imported = 0, skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(c => c.trim().replace(/"/g, ''));
      const email = cols[emailIdx]?.toLowerCase().trim();
      if (!email || !email.includes('@')) { skipped++; continue; }

      const existing = await db.collection('contacts').findOne({ email });
      if (existing) { skipped++; continue; }

      await db.collection('contacts').insertOne({
        email,
        name: nameIdx >= 0 ? (cols[nameIdx] || '') : '',
        funnel,
        source,
        tags: tagsIdx >= 0 && cols[tagsIdx] ? cols[tagsIdx].split(';').map(t => t.trim()).filter(Boolean) : [],
        status: 'subscribed',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    }

    console.log(`[Email Marketing] CSV import: ${imported} added, ${skipped} skipped`);
    res.redirect(`/admin/email-marketing?tab=contacts&success=Imported+${imported}+contacts+(${skipped}+skipped)`);
  } catch (err) {
    console.error('CSV upload error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=CSV+import+failed');
  }
});

// ── Import clients as contacts ──
router.post('/contacts/import-clients', async (req, res) => {
  try {
    const db = req.db;
    const clients = await db.collection('clients').find({ email: { $exists: true, $ne: '' } }).toArray();
    let imported = 0, skipped = 0;

    for (const cl of clients) {
      const email = cl.email.toLowerCase().trim();
      const existing = await db.collection('contacts').findOne({ email });
      if (existing) { skipped++; continue; }

      await db.collection('contacts').insertOne({
        email,
        name: cl.name || '',
        funnel: cl.status === 'active' ? 'customer' : 'prospect',
        source: 'client-import',
        tags: ['client'],
        status: 'subscribed',
        clientId: cl._id.toString(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      imported++;
    }

    console.log(`[Email Marketing] Client import: ${imported} added, ${skipped} skipped`);
    res.redirect(`/admin/email-marketing?tab=contacts&success=Imported+${imported}+clients+(${skipped}+already+exist)`);
  } catch (err) {
    console.error('Client import error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=Client+import+failed');
  }
});

// ── Update contact funnel/status ──
router.post('/contacts/:id/update', async (req, res) => {
  try {
    const db = req.db;
    const update = {};
    if (req.body.funnel) update.funnel = req.body.funnel;
    if (req.body.status) update.status = req.body.status;
    if (req.body.tags !== undefined) update.tags = req.body.tags.split(',').map(t => t.trim()).filter(Boolean);
    update.updatedAt = new Date();

    await db.collection('contacts').updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
    res.redirect('/admin/email-marketing?tab=contacts&success=Contact+updated');
  } catch (err) {
    console.error('Contact update error:', err);
    res.redirect('/admin/email-marketing?tab=contacts&error=Update+failed');
  }
});

// ── Delete contact ──
router.post('/contacts/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('contacts').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/email-marketing?tab=contacts&success=Contact+removed');
});

// ── Create campaign ──
router.post('/campaigns', async (req, res) => {
  try {
    const db = req.db;
    const { subject, preheader, body, targetFunnel, targetTags } = req.body;
    if (!subject || !body) return res.redirect('/admin/email-marketing?tab=campaigns&error=Subject+and+body+required');

    await db.collection('campaigns').insertOne({
      subject,
      preheader: preheader || '',
      body,
      targetFunnel: targetFunnel || 'all',
      targetTags: targetTags ? targetTags.split(',').map(t => t.trim()).filter(Boolean) : [],
      status: 'draft',
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.redirect('/admin/email-marketing?tab=campaigns&success=Campaign+created');
  } catch (err) {
    console.error('Create campaign error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Failed+to+create+campaign');
  }
});

// ── Marketing Agent (must be before :id routes) ──
router.post('/campaigns/agent', async (req, res) => {
  const { messages, currentCampaign } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

  try {
    const db = req.db;
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Gather business context
    const [contactCount, design] = await Promise.all([
      db.collection('contacts').countDocuments({ status: 'subscribed' }),
      db.collection('design').findOne({}),
    ]);
    const agentName = design?.agent_name || 'the brand';

    const searchResults = await webSearch(lastUserMsg.slice(0, 200));

    let campaignCtx = '';
    if (currentCampaign?.parentSubject) {
      campaignCtx = `\n\nThis is a FOLLOW-UP to a previously sent campaign with subject: "${currentCampaign.parentSubject}".`
        + `\nTarget segment: ${currentCampaign.segment || 'all'}.`
        + (currentCampaign.subject ? `\nCurrent draft subject: "${currentCampaign.subject}"` : '')
        + `\nWrite a follow-up that references or builds on the original campaign. Adjust tone based on the segment (e.g. re-engage unopened, reward clickers, nudge openers).`;
    } else if (currentCampaign?.subject) {
      campaignCtx = `\n\nExisting campaign draft — subject: "${currentCampaign.subject}", target: "${currentCampaign.targetFunnel || 'all'}"`;
    }

    const researchCtx = searchResults && !searchResults.startsWith('Search')
      ? `\n\n--- WEB RESEARCH ---\n${searchResults}\n--- END RESEARCH ---`
      : '';

    const brandCtx = buildBrandContext(req.tenant?.brand || {});

    const systemPrompt = `You are a marketing email writing assistant for ${agentName}.

${brandCtx}

You have ${contactCount} subscribed contacts.

Your ONLY job is to output a JSON object. No prose before or after it. No markdown code fences. Just the raw JSON.

The JSON must have exactly this shape:
{
  "message": "one short sentence describing what you wrote",
  "fill": {
    "subject": "compelling email subject line (under 60 chars)",
    "preheader": "preview text shown in inbox (under 100 chars)",
    "body": "full HTML email body as a single escaped string"
  }
}

Rules for the body field:
- Write engaging marketing email HTML using <h2>, <p>, <strong>, <ul>, <li>, <a> tags
- Use {name} for personalization (recipient's name) and {email} for their email
- Include a clear call-to-action with a styled button
- Keep total length 150-400 words
- All double quotes inside the HTML must be escaped as \\"
- No literal newlines inside the JSON string — use \\n instead
- Tone: match the brand voice described above, professional but warm, not spammy

Tailor content to the business and audience described above.
${campaignCtx}${researchCtx}`;

    const raw = await callLLM(messages, systemPrompt);
    console.log('[email-agent] raw LLM response length:', raw.length);

    const parsed = tryParseAgentResponse(raw);
    console.log('[email-agent] fill keys:', Object.keys(parsed.fill || {}));

    res.json(parsed);
  } catch (err) {
    console.error('Email marketing agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Send campaign ──
router.post('/campaigns/:id/send', async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');
    if (campaign.status === 'sent') return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+already+sent');

    // Build contact filter — follow-up campaigns use explicit contact IDs
    let contacts;
    if (campaign.targetContactIds?.length) {
      contacts = await db.collection('contacts').find({
        _id: { $in: campaign.targetContactIds.map(id => id instanceof ObjectId ? id : new ObjectId(id)) },
        status: 'subscribed',
      }).toArray();
    } else {
      const contactFilter = { status: 'subscribed' };
      if (campaign.targetFunnel && campaign.targetFunnel !== 'all') {
        contactFilter.funnel = campaign.targetFunnel;
      }
      if (campaign.targetTags?.length) {
        contactFilter.tags = { $in: campaign.targetTags };
      }
      contacts = await db.collection('contacts').find(contactFilter).toArray();
    }
    if (!contacts.length) return res.redirect('/admin/email-marketing?tab=campaigns&error=No+matching+contacts');

    let sent = 0, failed = 0;
    for (const contact of contacts) {
      try {
        await sendCampaignEmail(contact.email, contact.name, campaign.subject, campaign.preheader, campaign.body, campaign._id, contact._id, req.tenant);
        sent++;
      } catch (err) {
        console.error(`[Campaign] Failed to send to ${contact.email}:`, err.message);
        failed++;
      }
    }

    await db.collection('campaigns').updateOne(
      { _id: campaign._id },
      { $set: { status: 'sent', sentCount: sent, failedCount: failed, sentAt: new Date(), updatedAt: new Date() } }
    );

    console.log(`[Email Marketing] Campaign "${campaign.subject}" sent to ${sent} contacts (${failed} failed)`);
    res.redirect(`/admin/email-marketing?tab=campaigns&success=Sent+to+${sent}+contacts`);
  } catch (err) {
    console.error('Send campaign error:', err);
    res.redirect(`/admin/email-marketing?tab=campaigns&error=${encodeURIComponent(err.message || 'Send failed')}`);
  }
});

// ── Campaign detail page (analytics + follow-up) ──
router.get('/campaigns/:id', async (req, res) => {
  try {
    const db = req.db;
    const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!campaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');

    // Get all events for this campaign
    const events = await db.collection('campaign_events')
      .find({ campaignId: campaign._id })
      .sort({ createdAt: -1 })
      .toArray();

    // Get all contacts that were targeted
    const contactFilter = { status: { $in: ['subscribed', 'unsubscribed', 'bounced'] } };
    if (campaign.targetFunnel && campaign.targetFunnel !== 'all') contactFilter.funnel = campaign.targetFunnel;
    if (campaign.targetTags?.length) contactFilter.tags = { $in: campaign.targetTags };
    const contacts = await db.collection('contacts').find(contactFilter).toArray();

    // Build per-contact engagement map
    const contactEngagement = {};
    for (const c of contacts) {
      contactEngagement[c._id.toString()] = { contact: c, opened: false, clicked: false, openCount: 0, clickCount: 0, clicks: [] };
    }
    for (const evt of events) {
      const rid = evt.contactId.toString();
      if (!contactEngagement[rid]) continue;
      if (evt.type === 'open') {
        contactEngagement[rid].opened = true;
        contactEngagement[rid].openCount++;
      }
      if (evt.type === 'click') {
        contactEngagement[rid].clicked = true;
        contactEngagement[rid].clickCount++;
        if (evt.url) contactEngagement[rid].clicks.push(evt.url);
      }
    }

    // Segment counts
    const segments = {
      all: contacts.length,
      opened: Object.values(contactEngagement).filter(e => e.opened).length,
      unopened: Object.values(contactEngagement).filter(e => !e.opened).length,
      clicked: Object.values(contactEngagement).filter(e => e.clicked).length,
      openedNotClicked: Object.values(contactEngagement).filter(e => e.opened && !e.clicked).length,
    };

    // Top clicked URLs
    const urlCounts = {};
    for (const evt of events) {
      if (evt.type === 'click' && evt.url) urlCounts[evt.url] = (urlCounts[evt.url] || 0) + 1;
    }
    const topUrls = Object.entries(urlCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Get list of other campaigns for "copy" feature
    const otherCampaigns = await db.collection('campaigns')
      .find({ _id: { $ne: campaign._id }, status: 'sent' })
      .sort({ sentAt: -1 }).limit(10)
      .project({ subject: 1, sentAt: 1 }).toArray();

    res.render('admin/email-marketing/detail', {
      user: req.adminUser,
      campaign,
      events,
      contactEngagement,
      segments,
      topUrls,
      otherCampaigns,
      qs: req.query,
    });
  } catch (err) {
    console.error('Campaign detail error:', err);
    res.redirect('/admin/email-marketing?tab=campaigns&error=Failed+to+load+campaign');
  }
});

// ── Create follow-up campaign based on engagement ──
router.post('/campaigns/:id/follow-up', async (req, res) => {
  try {
    const db = req.db;
    const parentCampaign = await db.collection('campaigns').findOne({ _id: new ObjectId(req.params.id) });
    if (!parentCampaign) return res.redirect('/admin/email-marketing?tab=campaigns&error=Campaign+not+found');

    const { segment, subject, preheader, body } = req.body;
    if (!subject || !body) return res.redirect(`/admin/email-marketing/campaigns/${req.params.id}?error=Subject+and+body+required`);

    // Get events for the parent campaign to determine who opened/clicked
    const events = await db.collection('campaign_events').find({ campaignId: parentCampaign._id }).toArray();
    const openedIds = new Set();
    const clickedIds = new Set();
    for (const evt of events) {
      if (evt.type === 'open') openedIds.add(evt.contactId.toString());
      if (evt.type === 'click') clickedIds.add(evt.contactId.toString());
    }

    // Get the original contact pool
    const contactFilter = { status: 'subscribed' };
    if (parentCampaign.targetFunnel && parentCampaign.targetFunnel !== 'all') contactFilter.funnel = parentCampaign.targetFunnel;
    if (parentCampaign.targetTags?.length) contactFilter.tags = { $in: parentCampaign.targetTags };
    const allContacts = await db.collection('contacts').find(contactFilter).toArray();

    // Filter by segment
    let targetContactIds;
    if (segment === 'unopened') {
      targetContactIds = allContacts.filter(c => !openedIds.has(c._id.toString())).map(c => c._id);
    } else if (segment === 'opened') {
      targetContactIds = allContacts.filter(c => openedIds.has(c._id.toString())).map(c => c._id);
    } else if (segment === 'clicked') {
      targetContactIds = allContacts.filter(c => clickedIds.has(c._id.toString())).map(c => c._id);
    } else if (segment === 'opened_not_clicked') {
      targetContactIds = allContacts.filter(c => openedIds.has(c._id.toString()) && !clickedIds.has(c._id.toString())).map(c => c._id);
    } else {
      targetContactIds = allContacts.map(c => c._id);
    }

    if (!targetContactIds.length) {
      return res.redirect(`/admin/email-marketing/campaigns/${req.params.id}?error=No+contacts+in+this+segment`);
    }

    // Create the follow-up campaign with explicit contact IDs
    const result = await db.collection('campaigns').insertOne({
      subject,
      preheader: preheader || '',
      body,
      targetFunnel: 'segment',
      targetTags: [],
      targetContactIds,
      parentCampaignId: parentCampaign._id,
      parentSegment: segment,
      status: 'draft',
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log(`[Email Marketing] Follow-up created for "${parentCampaign.subject}" → segment: ${segment}, ${targetContactIds.length} contacts`);
    res.redirect(`/admin/email-marketing?tab=campaigns&success=Follow-up+created+(${targetContactIds.length}+contacts)`);
  } catch (err) {
    console.error('Follow-up error:', err);
    res.redirect(`/admin/email-marketing/campaigns/${req.params.id}?error=${encodeURIComponent(err.message || 'Failed')}`);
  }
});

// ── Delete campaign ──
router.post('/campaigns/:id/delete', async (req, res) => {
  const db = req.db;
  await db.collection('campaigns').deleteOne({ _id: new ObjectId(req.params.id) });
  res.redirect('/admin/email-marketing?tab=campaigns&success=Campaign+deleted');
});

export default router;
