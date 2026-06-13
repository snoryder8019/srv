(function () {
  const data = JSON.parse(document.getElementById('meetingsData')?.textContent || '{}');
  const meetings = data.meetings || [];
  const deals = data.deals || [];
  const dealById = Object.fromEntries(deals.map((d) => [d.id, d]));

  // ── Variant switching ──
  const variantSel = document.querySelector('[data-control="variant"]');
  const views = document.querySelectorAll('[data-mtg-view]');
  function applyVariant() {
    const v = variantSel?.value || 'workspace';
    views.forEach((el) => (el.hidden = el.dataset.mtgView !== v));
  }
  variantSel?.addEventListener('change', applyVariant);
  applyVariant();

  // ── WORKSPACE ──
  const listEl = document.querySelector('[data-mtg-items]');
  const countEl = document.querySelector('[data-mtg-count]');
  const dealFilterEl = document.querySelector('[data-mtg-deal-filter]');
  const detailEl = document.querySelector('[data-mtg-detail]');
  let activeId = meetings[0]?.id || null;

  function visibleMeetings() {
    const dealId = dealFilterEl?.value || '';
    return meetings.filter((m) => !dealId || m.deal === dealId);
  }

  function renderList() {
    const vis = visibleMeetings();
    if (countEl) countEl.textContent = vis.length;
    if (!listEl) return;
    if (!vis.length) {
      listEl.innerHTML = '<li class="mll-mtg__empty">No meetings under this filter.</li>';
      return;
    }
    listEl.innerHTML = vis.map((m) => {
      const deal = dealById[m.deal];
      const isActive = m.id === activeId;
      return `<li>
        <button type="button" class="mll-mtg__item ${isActive ? 'is-active' : ''}" data-mtg-pick="${m.id}">
          <div class="mll-mtg__item-row">
            <span class="mll-mtg__item-title">${escape(m.title)}</span>
            <span class="mll-mtg__item-status mll-mtg__item-status--${m.status}">${escape(m.status)}</span>
          </div>
          <div class="mll-mtg__item-meta">
            ${deal ? `<span class="mll-mtg__item-deal">${escape(deal.name)}</span> · ` : ''}
            ${fmtTime(m.when)} · ${escape(m.duration)}
          </div>
          <div class="mll-mtg__item-tags">${(m.tags || []).map((t) => `<span class="mll-tag">${escape(t)}</span>`).join('')}</div>
        </button>
      </li>`;
    }).join('');
    listEl.querySelectorAll('[data-mtg-pick]').forEach((btn) =>
      btn.addEventListener('click', () => { activeId = btn.dataset.mtgPick; renderList(); renderDetail(); })
    );
  }

  function renderDetail() {
    const m = meetings.find((x) => x.id === activeId);
    if (!m || !detailEl) return;
    const deal = dealById[m.deal];
    detailEl.innerHTML = `
      <header class="mll-mtg__detail-head">
        <div>
          <div class="mll-mtg__detail-deal">${deal ? escape(deal.name) : ''}</div>
          <h3 class="mll-mtg__detail-title">${escape(m.title)}</h3>
          <div class="mll-mtg__detail-meta">${fmtTime(m.when)} · ${escape(m.duration)} · host ${escape(m.host)}</div>
          <div class="mll-mtg__detail-attendees">${(m.attendees || []).map((a) => `<span class="mll-tag">${escape(a)}</span>`).join('')}</div>
        </div>
        <div class="mll-mtg__detail-side">
          <div class="mll-mtg__share-row">
            <span class="mll-mtg__share-lbl">Shares</span>
            <div class="mll-mtg__share-targets">
              ${['buyer','lender','counsel','techdd'].map((t) => `
                <label class="mll-mtg__share-tgt ${(m.shares||[]).includes(t) ? 'is-on' : ''}">
                  <input type="checkbox" data-share-target="${t}" ${(m.shares||[]).includes(t) ? 'checked' : ''}/>
                  ${t}
                </label>`).join('')}
            </div>
          </div>
        </div>
      </header>

      <nav class="mll-mtg__tabs" data-mtg-tabs>
        <button type="button" class="is-active" data-tab="summary">Summary</button>
        <button type="button" data-tab="transcript">Transcript</button>
        <button type="button" data-tab="actions">Action items (${(m.actionItems||[]).length})</button>
        <button type="button" data-tab="tags">Tags &amp; notes</button>
      </nav>

      <div class="mll-mtg__panel" data-tab-panel="summary">
        <div class="mll-mtg__summary-ai">
          <span class="mll-pill mll-pill--accent">AI summary · MLL inference</span>
        </div>
        <p class="mll-mtg__summary">${escape(m.summary || '')}</p>
      </div>

      <div class="mll-mtg__panel" data-tab-panel="transcript" hidden>
        <div class="mll-mtg__transcript">
          ${(m.transcript || []).map((t) => `
            <div class="mll-mtg__turn mll-mtg__turn--${t.role || 'host'}">
              <div class="mll-mtg__turn-speaker">${escape(t.speaker)}</div>
              <div class="mll-mtg__turn-text">${escape(t.text)}</div>
            </div>`).join('')}
        </div>
        <div class="mll-mtg__live-badge ${m.status === 'recording' ? 'is-live' : ''}">
          ${m.status === 'recording' ? '● Recording — transcript updating live' : '✓ Transcribed · on MLL infra · not stored by any third party'}
        </div>
      </div>

      <div class="mll-mtg__panel" data-tab-panel="actions" hidden>
        <ul class="mll-mtg__actions-list">
          ${(m.actionItems || []).length ? (m.actionItems || []).map((a) => `
            <li class="mll-mtg__action ${a.done ? 'is-done' : ''}">
              <input type="checkbox" ${a.done ? 'checked' : ''} data-action-id="${a.id}" />
              <div>
                <div class="mll-mtg__action-task">${escape(a.task)}</div>
                <div class="mll-mtg__action-meta">${escape(a.owner)} · due ${escape(a.due)}</div>
              </div>
            </li>`).join('') : '<li class="mll-mtg__empty">No action items extracted yet.</li>'}
        </ul>
      </div>

      <div class="mll-mtg__panel" data-tab-panel="tags" hidden>
        <div class="mll-mtg__tags-row">
          <span class="mll-mtg__share-lbl">Tags</span>
          <div class="mll-mtg__tag-pool" data-tag-pool>
            ${(m.tags || []).map((t) => `<span class="mll-tag mll-tag--solid">${escape(t)}</span>`).join('')}
          </div>
          <input type="text" placeholder="add tag…" data-mtg-tag-input />
        </div>
        <div class="mll-mtg__notes">
          <span class="mll-mtg__share-lbl">Private notes (Meridian team only)</span>
          <textarea rows="4" placeholder="Type a note — autosaved locally for this demo…" data-mtg-notes></textarea>
        </div>
      </div>
    `;
    wireDetail(m);
  }

  function wireDetail(m) {
    const tabs = detailEl.querySelectorAll('[data-mtg-tabs] button');
    const panels = detailEl.querySelectorAll('[data-tab-panel]');
    tabs.forEach((btn) => btn.addEventListener('click', () => {
      tabs.forEach((b) => b.classList.toggle('is-active', b === btn));
      const t = btn.dataset.tab;
      panels.forEach((p) => (p.hidden = p.dataset.tabPanel !== t));
    }));

    detailEl.querySelectorAll('[data-share-target]').forEach((cb) =>
      cb.addEventListener('change', () => {
        cb.closest('label')?.classList.toggle('is-on', cb.checked);
        m.shares = Array.from(detailEl.querySelectorAll('[data-share-target]'))
          .filter((c) => c.checked).map((c) => c.dataset.shareTarget);
      })
    );

    detailEl.querySelectorAll('[data-action-id]').forEach((cb) =>
      cb.addEventListener('change', () => {
        const a = (m.actionItems || []).find((x) => x.id === cb.dataset.actionId);
        if (a) a.done = cb.checked;
        cb.closest('.mll-mtg__action')?.classList.toggle('is-done', cb.checked);
      })
    );

    const tagInput = detailEl.querySelector('[data-mtg-tag-input]');
    tagInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && tagInput.value.trim()) {
        const t = tagInput.value.trim();
        m.tags = [...(m.tags || []), t];
        const pool = detailEl.querySelector('[data-tag-pool]');
        if (pool) pool.insertAdjacentHTML('beforeend', `<span class="mll-tag mll-tag--solid">${escape(t)}</span>`);
        tagInput.value = '';
        renderList();
      }
    });

    const notes = detailEl.querySelector('[data-mtg-notes]');
    if (notes) {
      const key = `mllPitch:meridian:mtg:notes:${m.id}`;
      notes.value = localStorage.getItem(key) || '';
      notes.addEventListener('input', () => localStorage.setItem(key, notes.value));
    }
  }

  dealFilterEl?.addEventListener('change', () => {
    const vis = visibleMeetings();
    if (!vis.find((x) => x.id === activeId)) activeId = vis[0]?.id || null;
    renderList();
    renderDetail();
  });

  // ── CLIENT PORTAL ──
  const portalSel = document.querySelector('[data-mtg-portal-deal]');
  const portalMeetingsEl = document.querySelector('[data-mtg-portal-meetings]');
  const portalActionsEl = document.querySelector('[data-mtg-portal-actions]');
  const requestBtn = document.querySelector('[data-mtg-request]');

  function renderPortal() {
    const dealId = portalSel?.value || deals[0]?.id;
    const deal = dealById[dealId];
    const dealMeetings = meetings.filter((m) => m.deal === dealId);
    if (!portalMeetingsEl || !portalActionsEl) return;

    portalMeetingsEl.innerHTML = `
      <header class="mll-mtg__portal-head2">
        <h3>${deal ? escape(deal.name) : ''}</h3>
        <span class="mll-mtg__portal-stage">Current stage: <strong>${deal ? escape(deal.stage) : ''}</strong></span>
      </header>
      ${dealMeetings.map((m) => `
        <article class="mll-mtg__portal-card">
          <header>
            <div>
              <div class="mll-mtg__portal-card-title">${escape(m.title)}</div>
              <div class="mll-mtg__portal-card-meta">${fmtTime(m.when)} · ${escape(m.duration)}</div>
            </div>
            <span class="mll-mtg__item-status mll-mtg__item-status--${m.status}">${escape(m.status)}</span>
          </header>
          <p class="mll-mtg__portal-card-summary">${escape(m.summary || '')}</p>
          <div class="mll-mtg__portal-card-tags">${(m.tags || []).map((t) => `<span class="mll-tag">${escape(t)}</span>`).join('')}</div>
        </article>
      `).join('')}
    `;

    const openActions = dealMeetings.flatMap((m) => (m.actionItems || []).map((a) => ({ ...a, mtg: m.title })))
      .filter((a) => !a.done);
    portalActionsEl.innerHTML = `
      <header><strong>Open action items</strong></header>
      ${openActions.length ? `<ul class="mll-mtg__portal-actions-list">
        ${openActions.map((a) => `<li>
          <div class="mll-mtg__action-task">${escape(a.task)}</div>
          <div class="mll-mtg__action-meta">${escape(a.owner)} · due ${escape(a.due)}</div>
          <div class="mll-mtg__action-source">from "${escape(a.mtg)}"</div>
        </li>`).join('')}
      </ul>` : '<p class="mll-mtg__empty">All caught up.</p>'}
    `;
  }
  portalSel?.addEventListener('change', renderPortal);
  requestBtn?.addEventListener('click', () => {
    alert('(Demo) request would open a calendar picker scoped to the deal partner team.');
  });

  // initial render
  renderList();
  renderDetail();
  renderPortal();

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
  }
  function escape(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
})();
