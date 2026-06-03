(function () {
  const data = JSON.parse(document.getElementById('workflowData').textContent || '{}');
  function init() {
    if (!window.Chart) return setTimeout(init, 50);
    let c = null;
    const ctx = document.getElementById('workflowChart').getContext('2d');
    const stages = data.throughput?.stages || [];
    const cur = data.throughput?.currentDays || [];
    const tgt = data.throughput?.targetDays || [];
    const palette = { tick: '#6B6353', text: '#1F1A12', grid: 'rgba(31,26,18,0.08)', cur: '#B91C1C', tgt: '#0F766E' };

    function destroy() { if (c) { c.destroy(); c = null; } }

    function render(variant) {
      destroy();
      if (variant === 'radar') {
        c = new Chart(ctx, {
          type: 'radar',
          data: {
            labels: stages,
            datasets: [
              { label: 'Current (days)', data: cur, backgroundColor: 'rgba(185, 28, 28, 0.18)', borderColor: palette.cur, pointBackgroundColor: palette.cur },
              { label: 'With MLL (days)', data: tgt, backgroundColor: 'rgba(15, 118, 110, 0.18)', borderColor: palette.tgt, pointBackgroundColor: palette.tgt },
            ],
          },
          options: { responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: palette.text } } },
            scales: { r: { angleLines: { color: palette.grid }, grid: { color: palette.grid }, pointLabels: { color: palette.text }, ticks: { color: palette.tick, backdropColor: 'transparent' } } } },
        });
        return;
      }
      // bar-h (default)
      c = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: stages,
          datasets: [
            { label: 'Avg days (current)', data: cur, backgroundColor: palette.cur },
            { label: 'Avg days (with MLL)', data: tgt, backgroundColor: palette.tgt },
          ],
        },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: { legend: { labels: { color: palette.text } } },
          scales: {
            x: { ticks: { color: palette.tick }, grid: { color: palette.grid } },
            y: { ticks: { color: palette.tick }, grid: { color: palette.grid } },
          } },
      });
    }

    const sel = document.querySelector('[data-control="variant"]');
    render(sel?.value || 'bar-h');
    sel?.addEventListener('change', () => render(sel.value));
  }
  init();
})();
