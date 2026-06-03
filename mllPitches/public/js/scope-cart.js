(function () {
  const meta = window.__PITCH__ || {};
  const STORAGE_KEY = `mllPitch:${meta.slug}:cart`;

  const state = loadState();

  const els = {
    countAll: document.querySelectorAll('[data-cart-count]'),
    hoursAll: document.querySelectorAll('[data-cart-hours]'),
    costAll: document.querySelectorAll('[data-cart-cost]'),
    firmAll: document.querySelectorAll('[data-cart-firm]'),
    saveAll: document.querySelectorAll('[data-cart-save]'),
    items: document.querySelector('[data-cart-items]'),
    empty: document.querySelector('[data-cart-empty]'),
    drawer: document.getElementById('cartDrawer'),
    form: document.getElementById('cartForm'),
    status: document.querySelector('[data-cart-status]'),
  };

  document.querySelectorAll('.mll-scope__check').forEach((cb) => {
    const id = cb.dataset.scopeId;
    if (state[id]) cb.checked = true;
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state[id] = {
          id,
          viewSlug: cb.dataset.viewSlug,
          viewTitle: cb.dataset.viewTitle,
          title: cb.dataset.title,
          hours: Number(cb.dataset.hours) || 0,
          cost: Number(cb.dataset.cost) || 0,
          firmCost: Number(cb.dataset.firmCost) || 0,
        };
      } else {
        delete state[id];
      }
      persist();
      render();
    });
  });

  document.querySelectorAll('[data-cart-open]').forEach((btn) =>
    btn.addEventListener('click', () => {
      els.drawer.hidden = false;
      document.body.style.overflow = 'hidden';
    })
  );
  document.querySelectorAll('[data-cart-close]').forEach((btn) =>
    btn.addEventListener('click', () => {
      els.drawer.hidden = true;
      document.body.style.overflow = '';
    })
  );

  if (els.form) {
    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const selectedIds = Object.keys(state);
      if (!selectedIds.length) {
        showStatus('Pick at least one item first.', true);
        return;
      }
      const fd = new FormData(els.form);
      const payload = {
        clientSlug: meta.slug,
        selectedIds,
        notes: fd.get('notes') || '',
        contact: { name: fd.get('name') || '', email: fd.get('email') || '' },
      };
      try {
        const res = await fetch('/scope/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        showStatus(`Sent — reference ${data.id}. We'll be in touch.`, false);
        els.form.reset();
      } catch (err) {
        showStatus(`Couldn't send: ${err.message}`, true);
      }
    });
  }

  render();

  function render() {
    const items = Object.values(state);
    const totals = items.reduce(
      (acc, it) => ({ hours: acc.hours + it.hours, cost: acc.cost + it.cost, firm: acc.firm + (it.firmCost || it.cost * 3) }),
      { hours: 0, cost: 0, firm: 0 }
    );
    const save = totals.firm - totals.cost;
    els.countAll.forEach((n) => (n.textContent = items.length));
    els.hoursAll.forEach((n) => (n.textContent = totals.hours.toLocaleString()));
    els.costAll.forEach((n) => (n.textContent = totals.cost.toLocaleString()));
    els.firmAll.forEach((n) => (n.textContent = totals.firm.toLocaleString()));
    els.saveAll.forEach((n) => (n.textContent = save.toLocaleString()));

    if (els.items) {
      els.items.innerHTML = items
        .map(
          (it) => `
        <li>
          <div class="row"><strong>${escape(it.title)}</strong><span class="meta">${escape(it.viewTitle)}</span></div>
          <div class="row"><span class="meta">${it.hours} hrs</span><span class="meta"><s>$${(it.firmCost || it.cost * 3).toLocaleString()}</s> · <strong>$${it.cost.toLocaleString()}</strong></span></div>
        </li>`
        )
        .join('');
    }
    if (els.empty) els.empty.style.display = items.length ? 'none' : 'block';
  }

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }
  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function showStatus(msg, isError) {
    if (!els.status) return;
    els.status.textContent = msg;
    els.status.classList.toggle('is-error', !!isError);
  }
  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
