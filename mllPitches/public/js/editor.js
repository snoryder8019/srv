// editor.js — dynamic add/remove of scope + package rows and live cost calc
// for the Left Field pitch editor (edit.ejs). No build step; plain DOM.
(function () {
  'use strict';

  const form = document.querySelector('.ed-form');
  if (!form) return;

  const rateInput = document.getElementById('ed-rate');

  function currentRate() {
    const r = Number(rateInput && rateInput.value);
    return Number.isFinite(r) && r > 0 ? r : Number(form.dataset.rate) || 75;
  }

  function fmt(n) {
    return '$' + Math.round(n).toLocaleString();
  }

  // Recompute the MLL cost label on a single à-la-carte row.
  function recalcRow(row) {
    const hoursEl = row.querySelector('.ed-hours');
    const costEl = row.querySelector('.ed-cost__val');
    if (!hoursEl || !costEl) return;
    const hours = Math.max(0, Number(hoursEl.value) || 0);
    costEl.textContent = fmt(hours * currentRate());
  }

  function recalcAll() {
    form.querySelectorAll('.ed-row').forEach(recalcRow);
  }

  // ── live cost on hours / rate change ──
  form.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('ed-hours')) {
      recalcRow(e.target.closest('.ed-row'));
    } else if (e.target === rateInput) {
      recalcAll();
    }
  });

  // ── add row (from <template data-tpl="<group>">) ──
  form.addEventListener('click', function (e) {
    const addBtn = e.target.closest('[data-add-row]');
    if (addBtn) {
      const group = addBtn.getAttribute('data-add-row');
      const tpl = form.querySelector('template[data-tpl="' + group + '"]');
      const container = form.querySelector('[data-rows="' + group + '"]');
      if (tpl && container) {
        const node = tpl.content.firstElementChild.cloneNode(true);
        container.appendChild(node);
        recalcRow(node);
        const firstInput = node.querySelector('input[type="text"]');
        if (firstInput) firstInput.focus();
      }
      return;
    }
    const delBtn = e.target.closest('[data-del-row]');
    if (delBtn) {
      const row = delBtn.closest('.ed-row');
      if (row) row.remove();
    }
  });

  // ── reflect checkbox state on template cards (visual only) ──
  document.querySelectorAll('.ed-tpl input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      cb.closest('.ed-tpl').classList.toggle('is-checked', cb.checked);
    });
  });

  recalcAll();
})();
