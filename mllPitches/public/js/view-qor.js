(function () {
  const data = JSON.parse(document.getElementById('qorData').textContent || '{}');
  const palette = { recurring: '#4338CA', oneTime: '#0F766E', retention: '#B45309', tick: '#6B6353', text: '#1F1A12', grid: 'rgba(31,26,18,0.08)', cardBg: '#FBF7EE' };

  function init() {
    if (!window.Chart) return setTimeout(init, 50);

    let c1 = null, c2 = null;
    const ctx1 = document.getElementById('qorChart').getContext('2d');
    const ctx2 = document.getElementById('qorMix').getContext('2d');

    function destroy() { if (c1) c1.destroy(); if (c2) c2.destroy(); c1 = null; c2 = null; }

    function readControls() {
      const get = (k) => document.querySelector(`[data-control="${k}"]`)?.value;
      const numEl = document.querySelector('[data-control="num"][data-key="retentionAdj"]');
      return {
        variant: get('variant') || 'stacked',
        viewSet: get('viewSet') || '',
        dateRange: get('dateRange') || '',
        retentionAdj: parseFloat(numEl?.value || '0'),
      };
    }

    function transform(c) {
      // Date-range slice
      const n = data.dateRanges?.[c.dateRange] ?? data.periods.length;
      const start = Math.max(0, data.periods.length - n);
      const periods = data.periods.slice(start);
      const recurring = data.recurring.slice(start);
      const oneTime = data.oneTime.slice(start);
      const retention = data.retention.slice(start).map((r) => Math.max(0, r + c.retentionAdj));

      // View-set splits: if a split is selected, replace 2-stack with N-segment split of (recurring+one-time)
      const split = data.viewSplits?.[c.viewSet];
      if (split && split.length) {
        const totals = periods.map((_, i) => recurring[i] + oneTime[i]);
        const datasets = split.map((seg) => ({
          name: seg.name,
          color: seg.color,
          data: totals.map((t) => Math.round(t * seg.weight)),
        }));
        return { periods, datasets, retention, split: true };
      }

      return {
        periods,
        datasets: [
          { name: 'Recurring', color: palette.recurring, data: recurring },
          { name: 'One-time', color: palette.oneTime, data: oneTime },
        ],
        retention,
        split: false,
      };
    }

    function render() {
      const c = readControls();
      const t = transform(c);
      destroy();

      const stacked = c.variant !== 'grouped';
      const datasets = t.datasets.map((ds) => ({
        label: ds.name,
        data: ds.data,
        backgroundColor: ds.color,
        borderRadius: stacked ? 0 : 4,
      }));

      // Retention overlay only on stacked variant
      if (stacked) {
        datasets.push({
          label: 'Net retention %',
          data: t.retention,
          type: 'line',
          yAxisID: 'y2',
          borderColor: palette.retention,
          backgroundColor: 'rgba(255,181,71,0.2)',
          tension: 0.3,
          pointRadius: 3,
        });
      }

      c1 = new Chart(ctx1, {
        type: 'bar',
        data: { labels: t.periods, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: palette.text } },
            title: t.split ? { display: true, text: `Split: ${c.viewSet.replace('by-', '')}`, color: palette.text } : undefined,
          },
          scales: {
            x: { stacked, ticks: { color: palette.tick }, grid: { color: palette.grid } },
            y: { stacked, ticks: { color: palette.tick, callback: (v) => '$' + v.toLocaleString() }, grid: { color: palette.grid } },
            ...(stacked ? { y2: { position: 'right', ticks: { color: palette.retention, callback: (v) => v + '%' }, grid: { drawOnChartArea: false } } } : {}),
          },
        },
      });

      // Mix doughnut: always show the totals across active datasets
      const mixLabels = t.datasets.map((d) => d.name);
      const mixColors = t.datasets.map((d) => d.color);
      const mixValues = t.datasets.map((d) => d.data.reduce((a, b) => a + b, 0));
      c2 = new Chart(ctx2, {
        type: 'doughnut',
        data: { labels: mixLabels, datasets: [{ data: mixValues, backgroundColor: mixColors, borderColor: palette.cardBg, borderWidth: 3 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: palette.text } } } },
      });
    }

    document.querySelectorAll('.mll-controls [data-control]').forEach((el) => {
      el.addEventListener('change', render);
      el.addEventListener('input', render);
    });
    render();
  }
  init();
})();
