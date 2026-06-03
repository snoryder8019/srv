(function () {
  const data = JSON.parse(document.getElementById('packagesData').textContent || '{}');
  const palette = { spark: '#34d6c2', forge: '#7c5cff', foundry: '#ffb547', text: '#1F1A12', tick: '#6B6353', grid: 'rgba(31,26,18,0.08)' };

  const DELIVERABLES = [
    { key: 'channels',   label: 'Channels posted',     extract: (p) => /YouTube/.test((p.features || []).map((f) => f.label).join(' ')) ? 3 : (p.features || []).some((f) => /2 social channels|FB \+ IG/.test(f.label)) ? 2 : 1 },
    { key: 'posts',      label: 'Posts / month',       extract: (p) => p.id === 'foundry' ? 120 : p.id === 'forge' ? 24 : 4 },
    { key: 'blogs',      label: 'Blog posts',          extract: (p) => p.id === 'foundry' ? 2 : p.id === 'forge' ? 1 : 0 },
    { key: 'shoots',     label: 'Shoot days / quarter',extract: (p) => p.id === 'foundry' ? 3 : p.id === 'forge' ? 1 : 0 },
    { key: 'ads',        label: 'Ad mgmt',             extract: (p) => p.id === 'foundry' ? 1 : 0 },
    { key: 'marketplace',label: 'Marketplace ops',     extract: (p) => p.id === 'foundry' ? 1 : 0 },
  ];

  function init() {
    if (!window.Chart) return setTimeout(init, 50);
    const ctx = document.getElementById('packagesChart');
    if (!ctx) return;
    const pkgs = data.packages || [];
    const pkgColors = { spark: palette.spark, forge: palette.forge, foundry: palette.foundry };

    const datasets = pkgs.map((p) => ({
      label: p.name,
      data: DELIVERABLES.map((d) => d.extract(p)),
      backgroundColor: pkgColors[p.id] || palette.forge,
      borderRadius: 4,
    }));

    new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: { labels: DELIVERABLES.map((d) => d.label), datasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: palette.text } } },
        scales: {
          x: { beginAtZero: true, ticks: { color: palette.tick }, grid: { color: palette.grid } },
          y: { ticks: { color: palette.tick }, grid: { color: palette.grid } },
        },
      },
    });
  }
  init();
})();
