// Inline AI helpers for the post editor (new.ejs / edit.ejs).
// Talks to the same /admin/ai/api/* endpoints as the AI Studio hub.

(function () {
  const $ = (sel) => document.querySelector(sel);

  function status(text, kind = 'info') {
    const el = $('#ai-status');
    if (!el) return;
    const color = kind === 'error' ? '#f87171' : kind === 'ok' ? '#4ade80' : '#facc15';
    el.innerHTML = text
      ? `<span style="color:${color};margin-left:.5rem;">${text}</span>`
      : '';
  }

  async function call(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  function getCtx() {
    return {
      title: $('#post-title')?.value || '',
      body: $('#post-body')?.value || '',
      tags: $('#post-tags')?.value || ''
    };
  }

  function pickFromList(items, label) {
    const choice = window.prompt(`${label}\n\n${items.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\nEnter number (1-${items.length}) to use:`);
    const idx = Number(choice) - 1;
    return Number.isInteger(idx) && items[idx] ? items[idx] : null;
  }

  document.querySelectorAll('[data-ai]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const action = btn.dataset.ai;
      btn.disabled = true;
      try {
        if (action === 'draft') {
          const topic = window.prompt('What topic should the AI draft about?');
          if (!topic) return;
          status('Drafting (~20s)…');
          const r = await call('/admin/ai/api/draft', { topic, length: 'medium' });
          if (!$('#post-title').value) $('#post-title').value = r.title || '';
          $('#post-body').value = r.body || '';
          if (!$('#post-tags').value && r.tags?.length) $('#post-tags').value = r.tags.join(', ');
          status('Draft loaded — edit before publishing.', 'ok');
        }
        else if (action === 'headlines') {
          status('Generating headlines…');
          const ctx = getCtx();
          const r = await call('/admin/ai/api/headlines', { topic: ctx.title, body: ctx.body });
          const pick = pickFromList(r.headlines || [], 'Suggested headlines:');
          if (pick) $('#post-title').value = pick;
          status(pick ? 'Headline applied.' : '', 'ok');
        }
        else if (action === 'excerpt') {
          status('Writing excerpt…');
          const r = await call('/admin/ai/api/excerpt', { body: getCtx().body });
          if (r.excerpt && window.confirm(`Use this excerpt?\n\n${r.excerpt}`)) {
            // Excerpt is auto-generated server-side; just preview here.
            await navigator.clipboard.writeText(r.excerpt).catch(() => {});
            status('Copied excerpt to clipboard.', 'ok');
          } else status('');
        }
        else if (action === 'tags') {
          status('Suggesting tags…');
          const ctx = getCtx();
          const r = await call('/admin/ai/api/tags', { title: ctx.title, body: ctx.body });
          if (r.tags?.length) {
            const existing = ctx.tags.split(',').map(t => t.trim()).filter(Boolean);
            const merged = Array.from(new Set([...existing, ...r.tags]));
            $('#post-tags').value = merged.join(', ');
            status(`Added ${r.tags.length} tag suggestions.`, 'ok');
          } else status('No tags suggested.', 'error');
        }
        else if (action === 'seo') {
          status('Generating SEO pack…');
          const ctx = getCtx();
          const r = await call('/admin/ai/api/seo', { title: ctx.title, body: ctx.body });
          const text = `SEO title: ${r.seoTitle}\nMeta desc: ${r.metaDescription}\nOG title: ${r.ogTitle}\nOG desc: ${r.ogDescription}\nTwitter: ${r.twitterText}`;
          await navigator.clipboard.writeText(text).catch(() => {});
          window.alert(text + '\n\n(Copied to clipboard.)');
          status('SEO pack copied to clipboard.', 'ok');
        }
        else if (action === 'image') {
          const ctx = getCtx();
          status('Crafting image prompt…');
          const p = await call('/admin/ai/api/image-prompt', { title: ctx.title, body: ctx.body });
          const useDefault = window.confirm(`Generate cover image with this prompt?\n\n${p.prompt}\n\nOK = generate, Cancel = edit prompt`);
          let prompt = p.prompt;
          if (!useDefault) {
            const edited = window.prompt('Edit the SD prompt:', prompt);
            if (!edited) { status(''); return; }
            prompt = edited;
          }
          status('Generating image (15-45s)…');
          const img = await call('/admin/ai/api/image', { prompt, size: '768x512' });
          $('#cover-image-url').value = img.url;
          $('#ai-cover-preview').innerHTML =
            `<div style="margin-top:.5rem;padding:.5rem;background:#0d0d0d;border-radius:6px;">
              <img src="${img.url}" style="max-width:100%;border-radius:4px;">
              <p class="hint" style="margin:.4rem 0 0;">AI cover (saved at <code>${img.url}</code>). Will be used unless you upload a file above.</p>
            </div>`;
          status('Cover image ready.', 'ok');
        }
      } catch (e) {
        status(`Error: ${e.message}`, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
})();
