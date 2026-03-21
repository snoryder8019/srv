import express from 'express';
import { getDb } from '../../plugins/mongo.js';
const router = express.Router();

const SECTIONS = {
  hero: ['hero_eyebrow', 'hero_heading', 'hero_heading_em', 'hero_sub', 'hero_badge'],
  services: ['services_label', 'services_heading', 'services_heading_em', 'services_sub',
             'service1_title', 'service1_desc',
             'service2_title', 'service2_desc',
             'service3_title', 'service3_desc'],
  about: ['about_quote', 'about_desc', 'about_sig'],
  process: ['process_label', 'process_heading', 'process_heading_em'],
  contact: ['contact_sub', 'contact_location', 'contact_serving'],
};

const COPY_DEFAULTS = {
  hero_eyebrow: 'Greeley, Colorado — Digital Marketing Agency',
  hero_heading: 'Grow your brand',
  hero_heading_em: 'online.',
  hero_sub: 'Social media management, website design, and content creation — built for local businesses ready to stand out in Greeley and beyond.',
  hero_badge: 'Greeley, CO · Local Business First',
  services_label: 'What We Do',
  services_heading: 'Our',
  services_heading_em: 'Services',
  services_sub: 'Everything your business needs to build a powerful presence — from pixels to posts.',
  service1_title: 'Social Media Management',
  service1_desc: 'Strategy, scheduling, and engagement across all major platforms. We handle the day-to-day so you can focus on running your business.',
  service2_title: 'Website Design & Development',
  service2_desc: 'Custom, responsive websites that convert visitors into customers. Built for speed, SEO, and your brand identity.',
  service3_title: 'Content & Branding',
  service3_desc: 'Photography, graphics, copy, and full brand identity systems — everything you need to tell your story with confidence.',
  about_quote: '"No fluff — just digital marketing that actually works for local businesses."',
  about_desc: "We're a Greeley-based marketing team that partners with local businesses to make digital marketing simple, effective, and actually enjoyable.",
  about_sig: 'W2 Marketing',
  process_label: 'How It Works',
  process_heading: 'Simple',
  process_heading_em: 'Process',
  contact_sub: "Ready to grow your brand? Tell us a bit about your business and we'll be in touch within one business day.",
  contact_location: 'Greeley, Colorado',
  contact_serving: 'Northern Colorado & surrounding areas',
};

router.get('/', async (req, res) => {
  const db = getDb();
  const rawCopy = await db.collection('w2_copy').find({}).toArray();
  const copy = { ...COPY_DEFAULTS };
  for (const item of rawCopy) copy[item.key] = item.value;
  res.render('admin/copy/index', { user: req.adminUser, copy, sections: SECTIONS, flash: req.query.saved });
});

router.post('/', async (req, res) => {
  try {
    const db = getDb();
    const ops = [];
    for (const [key, value] of Object.entries(req.body)) {
      if (key.startsWith('_')) continue;
      ops.push(
        db.collection('w2_copy').updateOne(
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

    const systemPrompt = `You are a professional copywriting assistant for W2 Marketing — a digital marketing agency based in Greeley, Colorado that specializes in social media management, website design, and content creation for local businesses.

Your job is to help write and refine website copy that is compelling, professional, and conversion-focused. Keep copy concise, authentic, and tailored to local Colorado businesses.

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

    const llmRes = await fetch('https://ollama.madladslab.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 6255f716c9107e6e90de1cb06389a5fa763d4d6d7a5dd8d7b9063ea4c1db2c64',
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
