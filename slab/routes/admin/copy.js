import express from 'express';
import { getDb } from '../../plugins/mongo.js';
import { config } from '../../config/config.js';
import { buildBrandContext } from '../../plugins/brandContext.js';
const router = express.Router();

const SECTIONS = {
  hero: ['hero_eyebrow', 'hero_heading', 'hero_heading_em', 'hero_sub', 'hero_badge'],
  services: ['services_label', 'services_heading', 'services_heading_em', 'services_sub',
             'service1_title', 'service1_desc',
             'service2_title', 'service2_desc',
             'service3_title', 'service3_desc'],
  about: ['about_quote', 'about_desc', 'about_sig'],
  process: ['process_label', 'process_heading', 'process_heading_em',
           'process1_title', 'process1_desc',
           'process2_title', 'process2_desc',
           'process3_title', 'process3_desc',
           'process4_title', 'process4_desc'],
  contact: ['contact_sub', 'contact_location', 'contact_serving', 'contact_services'],
};

const COPY_DEFAULTS = {
  hero_eyebrow: 'Welcome',
  hero_heading: 'Grow your brand',
  hero_heading_em: 'online.',
  hero_sub: 'Professional services tailored to your business needs.',
  hero_badge: '',
  services_label: 'What We Do',
  services_heading: 'Our',
  services_heading_em: 'Services',
  services_sub: 'Everything your business needs to build a powerful presence.',
  service1_title: 'Service One',
  service1_desc: 'Description of your first service offering.',
  service2_title: 'Service Two',
  service2_desc: 'Description of your second service offering.',
  service3_title: 'Service Three',
  service3_desc: 'Description of your third service offering.',
  about_quote: '',
  about_desc: '',
  about_sig: '',
  process_label: 'How It Works',
  process_heading: 'Simple',
  process_heading_em: 'Process',
  process1_title: 'Discovery',
  process1_desc: 'We learn your goals, audience, and vision.',
  process2_title: 'Strategy',
  process2_desc: 'We build a custom plan tailored to your needs.',
  process3_title: 'Create',
  process3_desc: 'We produce and review deliverables with you.',
  process4_title: 'Launch & Grow',
  process4_desc: 'We go live, track results, and optimize.',
  contact_sub: "Ready to get started? Tell us about your project and we'll be in touch.",
  contact_location: '',
  contact_serving: '',
  contact_services: '',
};

router.get('/', async (req, res) => {
  const db = req.db;
  const rawCopy = await db.collection('copy').find({}).toArray();
  const copy = { ...COPY_DEFAULTS };
  for (const item of rawCopy) copy[item.key] = item.value;
  res.render('admin/copy/index', { user: req.adminUser, copy, sections: SECTIONS, flash: req.query.saved });
});

router.post('/', async (req, res) => {
  try {
    const db = req.db;
    const ops = [];
    for (const [key, value] of Object.entries(req.body)) {
      if (key.startsWith('_')) continue;
      ops.push(
        db.collection('copy').updateOne(
          { key },
          { $set: { key, value: value?.toString().trim(), updatedAt: new Date() } },
          { upsert: true }
        )
      );
    }
    await Promise.all(ops);
    res.redirect('/admin/copy?saved=1');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/copy?error=1');
  }
});

// Agent endpoint — proxies to Ollama LLM with copywriting system prompt
router.post('/agent', async (req, res) => {
  try {
    const { messages, currentCopy } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'messages required' });

    const copyContext = currentCopy
      ? `\n\nCurrent site copy fields:\n${Object.entries(currentCopy).map(([k, v]) => `  ${k}: "${v}"`).join('\n')}`
      : '';

    const brandCtx = buildBrandContext(req.tenant?.brand || {});

    const systemPrompt = `You are a professional copywriting assistant for the business.

${brandCtx}

Your job is to help write and refine website copy that is compelling, professional, and conversion-focused. Keep copy concise, authentic, and tailored to the business and its audience as described in the brand context above.

When the user asks you to fill out, generate, rewrite, or improve copy fields, you MUST respond with valid JSON in this exact format:
{
  "message": "A brief explanation of what you wrote and why.",
  "fill": {
    "field_key": "new value",
    ...
  }
}

Only include fields in "fill" that you are actually changing. If just having a conversation without generating copy, respond with:
{
  "message": "Your conversational response here.",
  "fill": {}
}

Available field keys:
- hero_eyebrow, hero_heading, hero_heading_em, hero_sub, hero_badge
- services_label, services_heading, services_heading_em, services_sub
- service1_title, service1_desc, service2_title, service2_desc, service3_title, service3_desc
- about_quote, about_desc, about_sig
- process_label, process_heading, process_heading_em
- contact_sub, contact_location, contact_serving
${copyContext}`;

    const payload = {
      model: 'qwen2.5:7b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages
      ],
      stream: false,
    };

    const llmRes = await fetch(config.OLLAMA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.OLLAMA_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error('LLM error:', errText);
      return res.status(502).json({ error: 'LLM request failed' });
    }

    const data = await llmRes.json();
    const raw = data.choices?.[0]?.message?.content || '';

    // Parse JSON response — Qwen may wrap in markdown code blocks
    let parsed;
    try {
      const stripped = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const jsonMatch = stripped.match(/\{[\s\S]*\}/);
      parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { message: stripped, fill: {} };
    } catch {
      parsed = { message: raw, fill: {} };
    }

    res.json(parsed);
  } catch (err) {
    console.error('Agent error:', err);
    res.status(500).json({ error: 'Agent error: ' + err.message });
  }
});

export default router;
