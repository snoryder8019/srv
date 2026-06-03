(function () {
  const data = JSON.parse(document.getElementById('wfDashboardData')?.textContent || '{}');
  if (!data || !data.kpis) return;

  const rangeEl = document.querySelector('[data-wf-range]');
  const partnerEl = document.querySelector('[data-wf-partner]');
  const badgeEl = document.querySelector('[data-wf-badge]');
  const sparksEl = document.querySelector('[data-wf-sparks]');

  function render() {
    const rangeId = rangeEl?.value || 'week';
    const partnerId = partnerEl?.value || 'all';
    const rangeLabel = (data.filters.timeRanges || []).find((r) => r.id === rangeId)?.label || rangeId;
    const partnerLabel = (data.filters.partners || []).find((p) => p.id === partnerId)?.label || partnerId;
    const scale = (data.partnerScale && data.partnerScale[partnerId]) || 1;
    const base = data.kpis[rangeId] || {};

    setKpi('activeDeals', Math.round((base.activeDeals || 0) * scale));
    setKpi('avgCycleDays', base.avgCycleDays || 0, 'd');
    setKpi('blockedItems', Math.round((base.blockedItems || 0) * scale));
    setKpi('uploadsToday', Math.round((base.uploadsToday || 0) * scale));
    if (base.onTimeStages) {
      const [num, denom] = String(base.onTimeStages).split('/').map((s) => parseInt(s.trim(), 10) || 0);
      const scaledNum = Math.round(num * scale);
      const scaledDen = Math.round(denom * scale);
      const el = document.querySelector('[data-wf-kpi="onTimeStages"]');
      if (el) el.textContent = scaledNum + ' / ' + scaledDen;
    }
    const targetEl = document.querySelector('[data-wf-kpi-sub="targetCycleDays"]');
    if (targetEl) targetEl.textContent = 'target ' + (base.targetCycleDays || 0) + 'd';

    if (badgeEl) badgeEl.textContent = `Showing: ${rangeLabel} · ${partnerLabel}`;

    // Sparklines per stage
    if (sparksEl) {
      const stages = data.stageStream || [];
      sparksEl.innerHTML = stages.map((s) => {
        const trend = s.trend.map((v) => Math.round(v * scale));
        return `<div class="mll-wf-spark">
          <div class="mll-wf-spark-head">
            <span class="mll-wf-spark-name">${s.stage}</span>
            <span class="mll-wf-spark-val">${trend[trend.length - 1]}d</span>
          </div>
          ${sparkline(trend)}
        </div>`;
      }).join('');
    }
  }

  function setKpi(key, val, suffix) {
    const el = document.querySelector(`[data-wf-kpi="${key}"]`);
    if (el) el.textContent = (typeof val === 'number' ? val.toLocaleString() : val) + (suffix || '');
  }

  function sparkline(values) {
    const w = 160, h = 36, pad = 2;
    const max = Math.max(...values, 1), min = Math.min(...values, 0);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2);
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const dLine = 'M' + pts.join(' L');
    const dArea = dLine + ` L${(w - pad).toFixed(1)},${h - pad} L${pad},${h - pad} Z`;
    return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="mll-wf-spark-svg">
      <path d="${dArea}" fill="rgba(67, 56, 202, 0.16)"/>
      <path d="${dLine}" fill="none" stroke="#4338CA" stroke-width="1.6"/>
    </svg>`;
  }

  [rangeEl, partnerEl].forEach((el) => el?.addEventListener('change', render));
  render();
})();
