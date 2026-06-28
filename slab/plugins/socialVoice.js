// ─────────────────────────────────────────────────────────────────────────────
// socialVoice.js — Brand-DNA "Voice Profile" for the social agent.
//
// A single per-tenant doc (collection `social_voice`) captures HOW the brand
// speaks: persona, audience, tone, signature phrases, words to avoid, emoji /
// hashtag policy, length preference, and a growing set of few-shot correction
// pairs ({ before, after }) harvested from the admin's own edits to drafts.
//
// loadVoiceBlock(db) returns a prompt-ready string that every social generator
// prepends to the brand context — so all copy sounds like the brand, not the
// model. Returns '' when unconfigured, so behavior is unchanged until set up.
// ─────────────────────────────────────────────────────────────────────────────
import { callLLM } from './agentMcp.js';

const FEWSHOT_CAP = 15;            // keep the most recent N correction pairs
const FEWSHOT_IN_PROMPT = 5;       // how many to actually inject

// The guided-Q&A fields the wizard collects (free text); synthesizeProfile turns
// these into the structured profile below.
export const VOICE_QUESTIONS = [
  { key: 'persona',          label: 'Who is speaking? (the voice / personality behind the posts)', placeholder: 'e.g. a sharp, slightly irreverent studio founder who ships fast' },
  { key: 'audience',         label: 'Who are you talking to?', placeholder: 'e.g. small-business owners and indie founders who hate corporate fluff' },
  { key: 'tone',             label: 'Three to five words for your tone', placeholder: 'e.g. confident, playful, concrete, no-jargon' },
  { key: 'signaturePhrases', label: 'Signature phrases / words you actually use', placeholder: 'e.g. "ship it", "madLads", "let’s build"' },
  { key: 'avoid',            label: 'Words / vibes to NEVER use', placeholder: 'e.g. "synergy", "leverage", "unlock", exclamation-point spam' },
  { key: 'emojiPolicy',      label: 'Emoji policy', placeholder: 'e.g. 1–2 max, never in the first line' },
  { key: 'hashtagPolicy',    label: 'Hashtag policy', placeholder: 'e.g. 2–3 lowercase, brand + topic only' },
  { key: 'lengthPref',       label: 'Length / rhythm preference', placeholder: 'e.g. punchy fragments, hook first, under 200 chars' },
  { key: 'extra',            label: 'Anything else that makes the voice yours?', placeholder: 'optional' },
];

const STRUCT_KEYS = ['persona', 'audience', 'tone', 'signaturePhrases', 'avoid', 'emojiPolicy', 'hashtagPolicy', 'lengthPref', 'channelOverrides'];

function asList(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v || '').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
}

// Read / write the single voice doc.
export async function getVoice(db) {
  return db.collection('social_voice').findOne({ _id: 'voice' });
}
export async function saveVoice(db, patch) {
  const $set = { ...patch, updatedAt: new Date() };
  delete $set._id;
  await db.collection('social_voice').updateOne(
    { _id: 'voice' },
    { $set, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return getVoice(db);
}

// Build the profile portion of the prompt block from structured fields.
// (Few-shot pairs are appended separately at load time so corrections always
// reflect without re-synthesizing.)
export function buildVoiceBlock(profile = {}) {
  const tone = asList(profile.tone);
  const sig = asList(profile.signaturePhrases);
  const avoid = asList(profile.avoid);
  const lines = ['--- BRAND VOICE PROFILE (write every post in THIS voice) ---'];
  if (profile.persona)        lines.push(`Voice / persona: ${profile.persona}`);
  if (profile.audience)       lines.push(`Audience: ${profile.audience}`);
  if (tone.length)            lines.push(`Tone: ${tone.join(', ')}`);
  if (sig.length)             lines.push(`Signature phrases to weave in naturally: ${sig.map(s => `"${s}"`).join(', ')}`);
  if (avoid.length)           lines.push(`NEVER use these words / vibes: ${avoid.join(', ')}`);
  if (profile.emojiPolicy)    lines.push(`Emoji policy: ${profile.emojiPolicy}`);
  if (profile.hashtagPolicy)  lines.push(`Hashtag policy: ${profile.hashtagPolicy}`);
  if (profile.lengthPref)     lines.push(`Length / rhythm: ${profile.lengthPref}`);
  if (profile.channelOverrides && Object.keys(profile.channelOverrides).length) {
    const co = Object.entries(profile.channelOverrides).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');
    if (co) lines.push(`Per-channel notes: ${co}`);
  }
  lines.push('--- END BRAND VOICE PROFILE ---');
  return lines.join('\n');
}

// Format the most recent correction pairs as a few-shot teaching block.
function fewShotBlock(fewShot = []) {
  const pairs = fewShot.slice(-FEWSHOT_IN_PROMPT).filter(p => p && p.after);
  if (!pairs.length) return '';
  const body = pairs.map(p => `GENERIC: ${String(p.before || '(draft)').slice(0, 240)}\nOURS: ${String(p.after).slice(0, 240)}`).join('\n---\n');
  return `\n--- HOW WE EDIT INTO OUR VOICE (match the "OURS" style) ---\n${body}\n--- END EXAMPLES ---`;
}

// Prompt-ready voice block for injection. Empty string when unconfigured.
export async function loadVoiceBlock(db) {
  let v;
  try { v = await getVoice(db); } catch { return ''; }
  if (!v) return '';
  const block = (v.voiceBlock && v.voiceBlock.trim()) ? v.voiceBlock.trim() : buildVoiceBlock(v);
  if (!block || !block.includes('VOICE')) return fewShotBlock(v.fewShot); // nothing meaningful yet
  return block + fewShotBlock(v.fewShot);
}

// Turn guided-Q&A answers into a structured profile + cached voiceBlock via LLM.
// Falls back to a deterministic build if the LLM output can't be parsed.
export async function synthesizeProfile(answers = {}, brandContext = '') {
  const sys = `You are a brand-voice strategist. From the brand context and the owner's answers below, distill a precise, reusable SOCIAL MEDIA VOICE PROFILE.

${brandContext}

Owner's answers:
${VOICE_QUESTIONS.map(q => `- ${q.label}\n  ${String(answers[q.key] || '(not given)').slice(0, 400)}`).join('\n')}

Output ONLY a raw JSON object (no prose, no code fences) of this exact shape:
{
  "persona": "one vivid sentence naming who is speaking",
  "audience": "who we're talking to",
  "tone": ["3-5", "tone", "words"],
  "signaturePhrases": ["phrases the brand actually uses"],
  "avoid": ["words/vibes to never use"],
  "emojiPolicy": "short rule",
  "hashtagPolicy": "short rule",
  "lengthPref": "short rule about length/rhythm",
  "examples": [
    { "before": "a flat, generic version of a post", "after": "the same idea rewritten in THIS brand voice" }
  ]
}
Rules: infer sensibly where an answer is missing. Write 3 distinct, realistic example pairs that show the voice flexing. Keep "after" examples under 240 characters. Escape double quotes as \\".`;

  let parsed = null;
  try {
    const raw = await callLLM([{ role: 'user', content: 'Build the voice profile now.' }], sys, 60000);
    const m = String(raw).replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch { /* fall back below */ }

  // Deterministic fallback straight from the raw answers.
  if (!parsed || typeof parsed !== 'object') {
    parsed = {
      persona: answers.persona || '', audience: answers.audience || '',
      tone: asList(answers.tone), signaturePhrases: asList(answers.signaturePhrases),
      avoid: asList(answers.avoid), emojiPolicy: answers.emojiPolicy || '',
      hashtagPolicy: answers.hashtagPolicy || '', lengthPref: answers.lengthPref || '',
      examples: [],
    };
  }

  const profile = {};
  for (const k of STRUCT_KEYS) if (parsed[k] !== undefined) profile[k] = parsed[k];
  profile.persona = profile.persona || answers.persona || '';
  profile.audience = profile.audience || answers.audience || '';
  profile.tone = asList(profile.tone);
  profile.signaturePhrases = asList(profile.signaturePhrases);
  profile.avoid = asList(profile.avoid);

  const seedFewShot = (Array.isArray(parsed.examples) ? parsed.examples : [])
    .filter(e => e && e.after)
    .map(e => ({ before: String(e.before || '').slice(0, 400), after: String(e.after).slice(0, 400), source: 'synthesis', at: new Date() }));

  return { profile, voiceBlock: buildVoiceBlock(profile), seedFewShot };
}

// Append a correction pair (admin edited a generated draft) — the "generate then
// you correct" feedback loop. Capped + deduped on the after-text.
export async function recordCorrection(db, { before, after, source = 'edit' }) {
  before = String(before || '').trim();
  after = String(after || '').trim();
  if (!after || before === after) return false;
  try {
    const v = await getVoice(db);
    const list = Array.isArray(v?.fewShot) ? v.fewShot.filter(p => p && p.after !== after) : [];
    list.push({ before: before.slice(0, 400), after: after.slice(0, 400), source, at: new Date() });
    await db.collection('social_voice').updateOne(
      { _id: 'voice' },
      { $set: { fewShot: list.slice(-FEWSHOT_CAP), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true },
    );
    return true;
  } catch { return false; }
}
