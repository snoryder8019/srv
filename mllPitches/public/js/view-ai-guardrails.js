(function () {
  const data = JSON.parse(document.getElementById('aiPipelineData').textContent || '{}');
  function init() {
    if (!window.echarts) return setTimeout(init, 50);
    const el = document.getElementById('aiPipeline');
    if (!el) return;
    let chart = null;
    const colors = ['#6B6353', '#4338CA', '#B45309', '#B91C1C', '#0F766E', '#15803D'];
    const labelColor = '#1F1A12';

    function destroy() { if (chart) { chart.dispose(); chart = null; } }

    function render(variant) {
      destroy();
      chart = echarts.init(el, null, { renderer: 'canvas' });

      if (variant === 'graph') {
        const nodes = (data.nodes || []).map((n) => ({
          name: n.name,
          symbolSize: 38,
          category: n.category,
          itemStyle: { color: colors[n.category] || colors[1] },
          label: { color: labelColor, fontSize: 12 },
        }));
        const links = (data.links || []).map((l) => ({ source: l.source, target: l.target, value: l.value }));
        chart.setOption({
          backgroundColor: 'transparent',
          tooltip: { trigger: 'item', formatter: (p) => p.dataType === 'edge' ? `${p.data.source} → ${p.data.target}` : `<strong>${p.data.name}</strong>` },
          legend: { show: false },
          series: [{
            type: 'graph',
            layout: 'force',
            roam: true,
            draggable: true,
            edgeSymbol: ['none', 'arrow'],
            edgeSymbolSize: [0, 8],
            force: { repulsion: 280, edgeLength: 110, gravity: 0.06 },
            label: { show: true, position: 'right', color: labelColor, fontSize: 12 },
            lineStyle: { color: '#4338CA', opacity: 0.4, curveness: 0.18, width: 1.5 },
            data: nodes,
            links,
          }],
        });
      } else {
        chart.setOption({
          backgroundColor: 'transparent',
          tooltip: { trigger: 'item', formatter: (p) => p.dataType === 'edge' ? `${p.data.source} → ${p.data.target}` : `<strong>${p.data.name}</strong>` },
          series: [{
            type: 'sankey',
            left: 10, right: 160, top: 10, bottom: 10,
            nodeAlign: 'left', nodeGap: 14, nodeWidth: 18,
            data: (data.nodes || []).map((n) => ({ name: n.name, itemStyle: { color: colors[n.category] || colors[1] }, label: { color: labelColor, fontSize: 12 } })),
            links: (data.links || []).map((l) => ({ source: l.source, target: l.target, value: l.value, lineStyle: { color: 'gradient', opacity: 0.5, curveness: 0.5 } })),
            emphasis: { focus: 'adjacency' },
          }],
        });
      }

      window.onresize = () => chart && chart.resize();
    }

    const sel = document.querySelector('[data-control="variant"]');
    render(sel?.value || 'sankey');
    sel?.addEventListener('change', () => render(sel.value));
  }
  init();
})();
