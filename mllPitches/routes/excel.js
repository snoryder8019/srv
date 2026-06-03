import express from 'express';
import multer from 'multer';
import xlsx from 'xlsx';

const router = express.Router();

// In-memory only — the buffer never touches disk
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const OLLAMA_BASE = process.env.OLLAMA_URL || process.env.OLLAMA_BASE || 'https://ollama.madladslab.com';
const OLLAMA_KEY = process.env.OLLAMA_KEY || '';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

const SYS_PROMPT = `You are a senior M&A diligence operator. Given a workbook summary, produce a concise diligence read:
(1) what data is in the workbook,
(2) any data-quality flags you can see (gaps, type mismatches, suspicious values, missing periods),
(3) 2-3 sharp follow-up questions to ask the counterparty.
Max 6 sentences total. No fluff, no preamble.`;

function summarizeWorkbook(buf, originalname) {
  const wb = xlsx.read(buf, { type: 'buffer', cellDates: true });
  const out = [];
  out.push(`Workbook: ${originalname || 'uploaded'}`);
  out.push(`Sheets (${wb.SheetNames.length}): ${wb.SheetNames.join(', ')}`);
  let totalRows = 0;
  // Tight caps so prompts stay short — Ollama on the tunnel reliably handles ~2KB,
  // can crash with "connection forcibly closed" on much larger payloads.
  for (const name of wb.SheetNames.slice(0, 6)) {
    const ws = wb.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
    if (!rows.length) {
      out.push(`Sheet "${name}": (empty)`);
      continue;
    }
    const headers = (rows[0] || []).slice(0, 10).map(String);
    const sample = rows.slice(1, 4);
    totalRows += rows.length - 1;
    out.push('');
    out.push(`Sheet "${name}": ${rows.length} rows × ${headers.length} columns`);
    if (headers.length) out.push(`  Headers: ${headers.join(' | ')}`);
    sample.forEach((r, i) => {
      const cells = r.slice(0, 10).map((v) => {
        if (v == null || v === '') return '—';
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        const s = String(v);
        return s.length > 30 ? s.slice(0, 28) + '…' : s;
      }).join(' | ');
      out.push(`  Row ${i + 1}: ${cells}`);
    });
  }
  let text = out.join('\n');
  // Hard cap on prompt size — keep the request small enough to survive the tunnel.
  if (text.length > 6000) text = text.slice(0, 6000) + '\n…(truncated)';
  return { text, sheetNames: wb.SheetNames, totalRows };
}

async function callOllamaWithRetry(body, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    const ctl = new AbortController();
    const timeoutId = setTimeout(() => ctl.abort(), 60_000);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (OLLAMA_KEY) headers.Authorization = `Bearer ${OLLAMA_KEY}`;
      const r = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctl.signal,
      });
      clearTimeout(timeoutId);
      if (r.ok) return await r.json();
      // 5xx — likely transient on the Ollama side. Retry.
      if (r.status >= 500 && i < attempts - 1) {
        await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
        continue;
      }
      const txt = await r.text().catch(() => '');
      lastErr = { status: r.status, detail: txt.slice(0, 400) };
      break;
    } catch (err) {
      clearTimeout(timeoutId);
      lastErr = { status: 0, detail: err.name === 'AbortError' ? 'timeout (60s)' : err.message };
      if (i < attempts - 1) {
        await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
        continue;
      }
    }
  }
  const err = new Error(`Ollama failed after ${attempts} attempts: ${lastErr?.status} ${lastErr?.detail || ''}`);
  err.upstream = lastErr;
  throw err;
}

router.post('/:slug', upload.single('file'), async (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: 'no file uploaded' });

  let parsed;
  try {
    parsed = summarizeWorkbook(req.file.buffer, req.file.originalname);
  } catch (err) {
    return res.status(400).json({ error: 'parse failed', detail: err.message });
  }

  // Wipe the buffer reference proactively — GC will reclaim the memory
  req.file.buffer = null;

  const messages = [
    { role: 'system', content: SYS_PROMPT },
    { role: 'user', content: `${parsed.text}\n\nGive the diligence read.` },
  ];

  try {
    const j = await callOllamaWithRetry({
      model: OLLAMA_MODEL,
      messages,
      temperature: 0.25,
      stream: false,
    });
    let reply = j?.choices?.[0]?.message?.content || '';
    reply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    res.json({
      reply,
      model: j?.model || OLLAMA_MODEL,
      sheets: parsed.sheetNames,
      totalRows: parsed.totalRows,
    });
  } catch (err) {
    res.status(502).json({
      error: 'Ollama unavailable — tunnel reset on every retry',
      detail: err.upstream?.detail || err.message,
      hint: 'Try a smaller sheet, or wait a moment for the model to warm up and retry.',
    });
  }
});

export default router;
