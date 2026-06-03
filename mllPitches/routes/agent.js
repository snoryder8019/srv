import express from 'express';
import { getPitch } from '../lib/pitchLoader.js';

const router = express.Router();

const OLLAMA_BASE = process.env.OLLAMA_URL || process.env.OLLAMA_BASE || 'https://ollama.madladslab.com';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
const OLLAMA_KEY = process.env.OLLAMA_KEY || process.env.MLL_OLLAMA_KEY || '';

const SYSTEM_REVIEWER = `You are the "Reviewer" — a senior M&A diligence operator embedded in the client's live deal cockpit.
You have read-access to the FULL client context: every active deal, every participant + their role + control level,
the permission matrix for the acting persona, the live workflow with deadlines, recent inbound emails, and the
catalogue of diligence views (QoR, NWC, Data Room, Trend & Forecast, Team Workflow, etc.) available to the team.
Be terse. 2–4 sentences max. Lead with the single most important call to make next.
If the gatekeeper has unfinished tasks but Delivery is being worked, flag it. If a recent inbound email matches
an open task, mention which task and recommend the assignee acknowledge. When the acting persona lacks a perm
that the next action requires, name the perm and who can grant it.
Never invent tasks, names, or numbers that are not in the provided state.`;

function fmtMM(n) {
  if (typeof n !== 'number') return '—';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
}

function summarizeWorkflow(workflow) {
  if (!workflow?.nodes) return '';
  return workflow.nodes.map((n) => {
    const tasks = (n.tasks || []).map((t) => {
      const due = t.deadline ? ` due:${String(t.deadline).slice(0, 10)}` : '';
      const ctrl = t.controlRequired ? ` ctrl:${t.controlRequired}` : '';
      return `  - [${t.done ? 'x' : ' '}] ${t.label} (assignee:${t.assignee}${due}${ctrl})`;
    }).join('\n');
    const nodeDue = n.deadline ? ` due:${String(n.deadline).slice(0, 10)}` : '';
    return `${n.isGate ? '(GATE) ' : ''}${n.name} · owner ${n.owner}${nodeDue} · status:${n.status || '?'}\n${tasks}`;
  }).join('\n');
}

function buildFullClientContext(pitch, { role, workflow, recentEmails, currentDealId }) {
  const app = pitch.app || {};
  const out = [];

  out.push(`Client: ${pitch.client} (${pitch.industry || ''})`);
  out.push(`Pitch summary: ${pitch.summary || ''}`);
  out.push('');

  // Deals — current + others
  const deals = app.deals || [];
  const currentDeal = deals.find((d) => d.id === currentDealId)
    || deals.find((d) => d.isCurrent)
    || deals[0];
  if (currentDeal) {
    out.push(`Currently viewing deal: ${currentDeal.name}`);
    out.push(`  buyer: ${currentDeal.buyer} · seller: ${currentDeal.seller}`);
    out.push(`  stage: ${currentDeal.stage} · headline: ${fmtMM(currentDeal.value)} · owner: ${currentDeal.owner}`);
  }
  const otherDeals = deals.filter((d) => d.id !== currentDeal?.id);
  if (otherDeals.length) {
    out.push('');
    out.push('Other active deals on the platform:');
    otherDeals.forEach((d) => {
      out.push(`  - ${d.name} (${d.buyer} ↔ ${d.seller}) · ${d.stage} · ${fmtMM(d.value)}`);
    });
  }
  out.push('');

  // Acting role + permissions
  out.push(`Acting role: ${role || 'unknown'}`);
  const roleObj = (app.roles || []).find((r) => r.id === role);
  if (roleObj) {
    out.push(`  label: ${roleObj.label} · group: ${roleObj.group} · scope: ${roleObj.scope} · default control: ${roleObj.defaultControl}`);
    if (roleObj.description) out.push(`  description: ${roleObj.description}`);
    const granted = (app.permissions || [])
      .filter((p) => (p.granted || []).includes(roleObj.id))
      .map((p) => p.label);
    out.push(`  permissions granted to this role: ${granted.join(', ') || '(none)'}`);
    const denied = (app.permissions || [])
      .filter((p) => !(p.granted || []).includes(roleObj.id))
      .map((p) => p.label);
    if (denied.length) out.push(`  permissions DENIED to this role: ${denied.join(', ')}`);
  }
  out.push('');

  // Participants directory (concise)
  const parts = app.participants || [];
  if (parts.length) {
    out.push(`Participants (${parts.length}):`);
    parts.forEach((p) => {
      const side = p.side ? ` · ${p.side}-side` : '';
      out.push(`  - ${p.name} [${p.id}] · ${p.title} · role:${p.role} · ctrl:${p.control}${side}`);
    });
    out.push('');
  }

  // Workflow detail
  out.push('Workflow (current deal):');
  out.push(summarizeWorkflow(workflow || app.workflow));
  out.push('');

  // Recent emails
  const emails = recentEmails || app.emails?.seed || [];
  if (emails.length) {
    out.push('Recent inbound emails (newest first):');
    emails.slice(0, 5).forEach((e) => {
      out.push(`  - ${e.from} — "${e.subject}" → task:${e.taskId || '(none)'}`);
    });
    out.push('');
  }

  // Diligence views catalogue (titles + one-line subtitle)
  const views = pitch.views || [];
  if (views.length) {
    out.push(`Diligence views available to the team (${views.length}):`);
    views.slice(0, 14).forEach((v) => {
      const sub = (v.subtitle || '').slice(0, 140);
      out.push(`  - ${v.title}${sub ? ' · ' + sub : ''}`);
    });
  }

  return out.join('\n');
}

router.post('/:slug', async (req, res) => {
  const pitch = getPitch(req.params.slug);
  if (!pitch?.app) return res.status(404).json({ error: 'no app context' });

  const { question, role, workflow, recentEmails, currentDealId, trigger } = req.body || {};
  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'question required' });
  }

  let stateSummary = buildFullClientContext(pitch, { role, workflow, recentEmails, currentDealId });
  // Hard cap to keep prompt within reliable tunnel size (~16KB) — workflow + view
  // catalogue can grow, but we never want the prompt to bloat past Ollama's window.
  if (stateSummary.length > 14000) stateSummary = stateSummary.slice(0, 14000) + '\n…(truncated)';

  const messages = [
    { role: 'system', content: SYSTEM_REVIEWER },
    { role: 'system', content: `Full client context:\n${stateSummary}` },
    { role: 'user', content: question.slice(0, 1200) },
  ];

  // trigger-aware prepend: shapes the response style for automated nudges
  const validTriggers = new Set(['task-toggle', 'node-complete', 'manual']);
  if (trigger && validTriggers.has(trigger)) {
    if (trigger === 'node-complete') {
      messages.unshift({
        role: 'system',
        content: 'A workflow node has just completed. Your job is to (a) acknowledge the closure tersely (1 short sentence), (b) name the next node and the first blocking task there with its assignee + deadline. Max 2 sentences total. Do not list more than one next task.',
      });
    } else if (trigger === 'task-toggle') {
      messages.unshift({
        role: 'system',
        content: 'A single task was just completed. Identify the next blocking task in the SAME node (assignee + deadline). 1 sentence.',
      });
    }
  }

  const body = {
    model: OLLAMA_MODEL,
    messages,
    temperature: 0.3,
    stream: false,
  };

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (OLLAMA_KEY) headers.Authorization = `Bearer ${OLLAMA_KEY}`;
    const r = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      return res.status(502).json({ error: `upstream ${r.status}`, detail: txt.slice(0, 400) });
    }
    const j = await r.json();
    let reply = j?.choices?.[0]?.message?.content || '';
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    res.json({ reply, model: j?.model || OLLAMA_MODEL });
  } catch (err) {
    res.status(500).json({ error: 'agent failed', detail: err.message });
  }
});

export default router;
