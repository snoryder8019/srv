// AI Studio client — drives /admin/ai hub.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function setLoading(el, label = 'Working') {
  el.innerHTML = `<span class="ai-spinner"></span> ${label}…`;
}

function showError(el, err) {
  el.innerHTML = `<div style="color:#f87171;"><strong>Error:</strong> ${escapeHtml(err.message || String(err))}</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

function copyButton(text) {
  return `<button class="btn btn-outline btn-xs" onclick="navigator.clipboard.writeText(this.dataset.copy);this.textContent='Copied'" data-copy="${escapeHtml(text)}">Copy</button>`;
}

// ── Tabs ────────────────────────────────────────────────────────────────────
$$('.ai-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.ai-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.tab;
    $$('.ai-panel').forEach(p => { p.hidden = p.dataset.panel !== target; });
  });
});

// ── Health ──────────────────────────────────────────────────────────────────
$('#ai-health')?.addEventListener('click', async () => {
  const out = $('#ai-health-result');
  out.textContent = 'pinging…';
  try {
    const r = await fetch('/admin/ai/api/health').then(x => x.json());
    out.textContent = r.ok ? `✓ ${r.model}` : `✗ ${r.error || 'fail'}`;
    out.className = r.ok ? 'status-badge status-green' : 'status-badge status-red';
  } catch (e) {
    out.textContent = `✗ ${e.message}`;
    out.className = 'status-badge status-red';
  }
});

// ── Draft ───────────────────────────────────────────────────────────────────
$('#btn-draft')?.addEventListener('click', async () => {
  const out = $('#out-draft');
  setLoading(out, 'Drafting article (~20s)');
  try {
    const tags = ($('#draft-tags').value || '').split(',').map(t => t.trim()).filter(Boolean);
    const r = await post('/admin/ai/api/draft', {
      topic: $('#draft-topic').value,
      angle: $('#draft-angle').value,
      length: $('#draft-length').value,
      tags
    });
    out.innerHTML = `
      <div class="copy-row"><strong>Title:</strong> <code>${escapeHtml(r.title || '')}</code> ${copyButton(r.title || '')}</div>
      <div class="copy-row"><strong>Excerpt:</strong> <code>${escapeHtml(r.excerpt || '')}</code> ${copyButton(r.excerpt || '')}</div>
      <div><strong>Tags:</strong> ${(r.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</div>
      <div style="margin-top:.5rem;"><strong>Body preview:</strong> ${copyButton(r.body || '')}</div>
      <div class="draft-preview">${r.body || ''}</div>
    `;
  } catch (e) { showError(out, e); }
});

// ── Quick tools ─────────────────────────────────────────────────────────────
$('#btn-headlines')?.addEventListener('click', async () => {
  const out = $('#out-quick');
  setLoading(out, 'Generating headlines');
  try {
    const r = await post('/admin/ai/api/headlines', { body: $('#quick-body').value, topic: $('#quick-title').value });
    out.innerHTML = '<strong>Headlines:</strong><ul>' +
      r.headlines.map(h => `<li>${escapeHtml(h)} ${copyButton(h)}</li>`).join('') +
      '</ul>';
  } catch (e) { showError(out, e); }
});

$('#btn-excerpt')?.addEventListener('click', async () => {
  const out = $('#out-quick');
  setLoading(out, 'Writing excerpt');
  try {
    const r = await post('/admin/ai/api/excerpt', { body: $('#quick-body').value });
    out.innerHTML = `<div class="copy-row"><code>${escapeHtml(r.excerpt)}</code> ${copyButton(r.excerpt)}</div>`;
  } catch (e) { showError(out, e); }
});

$('#btn-tags')?.addEventListener('click', async () => {
  const out = $('#out-quick');
  setLoading(out, 'Picking tags');
  try {
    const r = await post('/admin/ai/api/tags', { body: $('#quick-body').value, title: $('#quick-title').value });
    out.innerHTML = '<strong>Tags:</strong> ' + r.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ') +
      ' ' + copyButton(r.tags.join(', '));
  } catch (e) { showError(out, e); }
});

// ── SEO ─────────────────────────────────────────────────────────────────────
$('#btn-seo')?.addEventListener('click', async () => {
  const out = $('#out-seo');
  setLoading(out, 'Generating SEO pack');
  try {
    const r = await post('/admin/ai/api/seo', { title: $('#seo-title').value, body: $('#seo-body').value });
    out.innerHTML = `
      <div class="copy-row"><strong>SEO title:</strong> <code>${escapeHtml(r.seoTitle || '')}</code> ${copyButton(r.seoTitle || '')}</div>
      <div class="copy-row"><strong>Meta description:</strong> <code>${escapeHtml(r.metaDescription || '')}</code> ${copyButton(r.metaDescription || '')}</div>
      <div class="copy-row"><strong>OG title:</strong> <code>${escapeHtml(r.ogTitle || '')}</code> ${copyButton(r.ogTitle || '')}</div>
      <div class="copy-row"><strong>OG description:</strong> <code>${escapeHtml(r.ogDescription || '')}</code> ${copyButton(r.ogDescription || '')}</div>
      <div class="copy-row"><strong>Twitter:</strong> <code>${escapeHtml(r.twitterText || '')}</code> ${copyButton(r.twitterText || '')}</div>
    `;
  } catch (e) { showError(out, e); }
});

// ── Image ───────────────────────────────────────────────────────────────────
$('#btn-image')?.addEventListener('click', async () => {
  const out = $('#out-image');
  setLoading(out, 'Generating image (15-45s)');
  try {
    const r = await post('/admin/ai/api/image', {
      prompt: $('#img-prompt').value,
      negative_prompt: $('#img-neg').value,
      size: $('#img-size').value,
      steps: Number($('#img-steps').value),
      guidance: Number($('#img-guidance').value),
      seed: $('#img-seed').value || null
    });
    out.innerHTML = `
      <div class="ai-img-result">
        <div class="copy-row"><strong>Saved URL:</strong> <code>${escapeHtml(r.url)}</code> ${copyButton(r.url)}</div>
        <img src="${r.url}" alt="generated">
      </div>
    `;
  } catch (e) { showError(out, e); }
});

$('#btn-imgprompt')?.addEventListener('click', async () => {
  const out = $('#out-image');
  setLoading(out, 'Crafting prompt');
  try {
    const r = await post('/admin/ai/api/image-prompt', { title: $('#imgsuggest-title').value, body: $('#imgsuggest-body').value });
    $('#img-prompt').value = r.prompt;
    out.innerHTML = `<div>Prompt populated above. ${copyButton(r.prompt)}</div>`;
  } catch (e) { showError(out, e); }
});

// ── Report ──────────────────────────────────────────────────────────────────
$('#btn-report')?.addEventListener('click', async () => {
  const out = $('#out-report');
  setLoading(out, 'Generating briefing');
  try {
    const r = await post('/admin/ai/api/report', {});
    const rep = r.report;
    out.innerHTML = `
      <h3>${escapeHtml(rep.headline || 'This week')}</h3>
      <p class="hint">${new Date(r.generatedAt).toLocaleString()} · ${r.stats.publishedPosts} published / ${r.stats.totalPosts} total · ${r.stats.pendingCount} pending</p>
      <h4>Wins</h4><ul>${(rep.wins||[]).map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      <h4>Watch</h4><ul>${(rep.watch||[]).map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>
      <h4>Story pitches</h4>
      ${(rep.ideaPitches||[]).map(p => `
        <div class="idea-pitch">
          <h4>${escapeHtml(p.title || '')}</h4>
          <p>${escapeHtml(p.angle || '')}</p>
          <div>${(p.tags||[]).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</div>
        </div>`).join('')}
      <h4>Civic hooks</h4><ul>${(rep.civicHooks||[]).map(c => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    `;
  } catch (e) { showError(out, e); }
});

// ── Moderate ────────────────────────────────────────────────────────────────
$('#btn-moderate')?.addEventListener('click', async () => {
  const out = $('#out-moderate');
  setLoading(out, 'Screening pending queue (this can take a while)');
  try {
    const r = await post('/admin/ai/api/moderate-pending', {});
    if (!r.count) { out.innerHTML = '<p>No pending items.</p>'; return; }
    out.innerHTML = r.results.map(item => `
      <div class="mod-card verdict-${item.verdict.verdict}">
        <div><span class="verdict-${item.verdict.verdict}">${item.verdict.verdict.toUpperCase()}</span>
             <span class="hint">(conf ${(item.verdict.confidence ?? 0).toFixed(2)})</span>
             · <strong>${escapeHtml(item.kind)}</strong>
             · ${escapeHtml((item.label || '').slice(0, 80))}</div>
        <div>${escapeHtml(item.verdict.summary || '')}</div>
        ${item.verdict.reasons?.length ? `<ul style="margin:.25rem 0 0 1rem;font-size:.85rem;">${item.verdict.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
      </div>
    `).join('');
  } catch (e) { showError(out, e); }
});

// ── Chat ────────────────────────────────────────────────────────────────────
const chatHistory = [];
function appendMsg(role, content) {
  const log = $('#chat-log');
  const div = document.createElement('div');
  div.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
  div.textContent = content;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}
$('#btn-chat')?.addEventListener('click', async () => {
  const input = $('#chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendMsg('user', msg);
  chatHistory.push({ role: 'user', content: msg });
  appendMsg('bot', '…thinking');
  const placeholder = $('#chat-log').lastChild;
  try {
    const r = await post('/admin/ai/api/chat', { message: msg, history: chatHistory.slice(0, -1) });
    placeholder.textContent = r.reply;
    chatHistory.push({ role: 'assistant', content: r.reply });
  } catch (e) {
    placeholder.textContent = `Error: ${e.message}`;
  }
});
$('#chat-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#btn-chat').click(); }
});
