(function () {
  const nodes = JSON.parse(document.getElementById('timelineData')?.textContent || '[]');
  const nodeById = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const timeline = document.getElementById('dealTimeline');
  const pop = document.getElementById('timelinePopover');
  if (!timeline || !pop) return;

  // Color bubble fills by pct via HSL (red→amber→green)
  timeline.querySelectorAll('[data-pct-fill]').forEach((el) => {
    const pct = Math.max(0, Math.min(100, Number(el.dataset.pctFill) || 0));
    const hue = Math.round((pct / 100) * 120); // 0=red, 120=green
    const sat = pct === 0 ? 60 : 70;
    const light = pct === 100 ? 40 : 50;
    el.style.background = `hsl(${hue} ${sat}% ${light}%)`;
    // ring shows completion as a conic gradient
    el.style.setProperty('--pct', pct);
  });

  let active = null;
  const refs = {
    name: pop.querySelector('[data-pop-name]'),
    pct: pop.querySelector('[data-pop-pct]'),
    meta: pop.querySelector('[data-pop-meta]'),
    completed: pop.querySelector('[data-pop-completed]'),
    needed: pop.querySelector('[data-pop-needed]'),
  };

  function show(btn) {
    const id = btn.dataset.nodeId;
    const n = nodeById[id];
    if (!n) return;
    active = btn;
    refs.name.textContent = n.name;
    refs.pct.textContent = `${n.completion}% complete`;
    refs.pct.style.color = `hsl(${Math.round((n.completion / 100) * 120)} 70% ${n.completion === 100 ? 45 : 55}%)`;
    refs.meta.textContent = `${n.sla} · ${n.owner}`;
    refs.completed.innerHTML = (n.completed || []).map(escape).map((s) => `<li>${s}</li>`).join('') || '<li class="muted">Nothing yet</li>';
    refs.needed.innerHTML = (n.needed || []).map(escape).map((s) => `<li>${s}</li>`).join('') || '<li class="muted">Nothing outstanding</li>';

    pop.hidden = false;
    const tRect = timeline.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    const popW = Math.min(360, tRect.width - 24);
    pop.style.width = popW + 'px';
    let left = bRect.left - tRect.left + bRect.width / 2 - popW / 2;
    left = Math.max(8, Math.min(tRect.width - popW - 8, left));
    pop.style.left = left + 'px';
    pop.style.top = bRect.bottom - tRect.top + 14 + 'px';
  }

  function hide() {
    pop.hidden = true;
    active = null;
  }

  timeline.querySelectorAll('.mll-timeline__node').forEach((btn) => {
    btn.addEventListener('mouseenter', () => show(btn));
    btn.addEventListener('focus', () => show(btn));
    btn.addEventListener('mouseleave', (e) => {
      // keep open if cursor moves into popover
      const to = e.relatedTarget;
      if (to && pop.contains(to)) return;
      hide();
    });
    btn.addEventListener('blur', hide);
    btn.addEventListener('click', () => show(btn));
  });
  pop.addEventListener('mouseleave', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });

  function escape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
