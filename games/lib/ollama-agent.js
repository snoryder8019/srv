// Thin client around the madLadsLab Ollama endpoint. Used by the admin
// communications composer to draft landing-page announcements, help blurbs,
// and incident notices. Failures return a plain Error — the route layer
// surfaces the message to the admin UI.
const URL = process.env.OLLAMA_URL || 'https://ollama.madladslab.com/v1/chat/completions';
const KEY = process.env.OLLAMA_KEY || '';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

const BASE_SYSTEM = `You are the communications writer for MadLadsLab Games — a community gaming hub running dedicated Rust, Valheim, Left 4 Dead 2, 7 Days to Die, Space Engineers, Palworld, Windrose, and Minecraft servers. You also run live broadcasts and voice chat for the community.

Voice: terse, retro-gamer arcade tone. Confident but not corporate. No marketing fluff, no emoji unless asked. Short sentences. Plain language.

When you write, return ONLY the message text — no preamble, no JSON, no markdown headers, no "Here is...". Just the announcement copy as it should appear on the landing page.

Keep it under 200 words unless asked to go longer. Aim for 2-4 short paragraphs.`;

const KIND_HINTS = {
  news:        'Tone: informational. Sharing something interesting or new.',
  update:      'Tone: changelog-ish. What changed, what to expect.',
  help:        'Tone: how-to. Walk a player through a specific action.',
  maintenance: 'Tone: heads-up. When, how long, what is affected.',
  event:       'Tone: hype but measured. When the event runs, who can join, what is at stake.',
  note:        'Tone: brief footnote.',
};

async function compose({ prompt, kind = 'news', tone = 'info', extraContext = '' } = {}) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt required');
  if (!KEY) throw new Error('OLLAMA_KEY not configured');

  const kindHint = KIND_HINTS[kind] || KIND_HINTS.news;
  const toneHint = tone === 'critical' ? 'This is a CRITICAL notice — be direct, no fluff.'
                 : tone === 'warning'  ? 'This is a WARNING — caution the reader without alarming.'
                 : tone === 'success'  ? 'This is a positive update — celebratory but restrained.'
                 : 'Default neutral tone.';

  const sys = `${BASE_SYSTEM}

KIND: ${kind}. ${kindHint}
${toneHint}${extraContext ? '\n\nADDITIONAL CONTEXT:\n' + extraContext : ''}`;

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: String(prompt).slice(0, 2000) },
    ],
    stream: false,
    temperature: 0.7,
  };

  // 60s soft cap — Ollama deepseek/qwen typically replies in 3-15s; longer
  // means the GPU is busy and the admin should retry rather than block.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + KEY },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('Ollama HTTP ' + r.status + (txt ? ': ' + txt.slice(0, 200) : ''));
    }
    const data = await r.json();
    let text = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    // Some Ollama models (deepseek-r1) prepend a <think>...</think> reasoning
    // block that has to be stripped before display.
    text = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
    if (!text) throw new Error('Empty response from Ollama');
    return { text, model: data.model || MODEL };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Ollama timeout (60s)');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { compose };
