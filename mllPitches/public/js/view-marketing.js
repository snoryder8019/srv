(function () {
  const data = JSON.parse(document.getElementById('marketingData').textContent || '{}');

  function init() {
    if (!window.echarts) return setTimeout(init, 50);

    const funnelEl = document.getElementById('mkFunnel');
    if (funnelEl) {
      const fchart = echarts.init(funnelEl);
      fchart.setOption({
        tooltip: { trigger: 'item', formatter: (p) => `${p.name}<br/>${p.value.toLocaleString()}` },
        series: [{
          type: 'funnel',
          left: '6%',
          right: '6%',
          top: 10,
          bottom: 10,
          minSize: '20%',
          maxSize: '100%',
          gap: 2,
          sort: 'descending',
          label: { show: true, position: 'inside', color: '#fff', formatter: '{b}\n{c}' },
          labelLine: { show: false },
          itemStyle: { borderColor: '#FBF7EE', borderWidth: 2 },
          data: (data.funnel || []).map((f, i) => ({
            name: f.stage,
            value: f.value,
            itemStyle: { color: ['#34d6c2', '#7c5cff', '#ffb547', '#ff6b9b', '#4338CA', '#0F766E'][i % 6] },
          })),
        }],
      });
      window.addEventListener('resize', () => fchart.resize());
    }

    const srcEl = document.getElementById('mkSources');
    if (srcEl) {
      const schart = echarts.init(srcEl);
      const sources = data.sources || [];
      schart.setOption({
        tooltip: { trigger: 'item' },
        legend: { bottom: 0, textStyle: { color: '#1F1A12' } },
        series: [
          {
            name: 'Sessions',
            type: 'pie',
            radius: ['35%', '60%'],
            center: ['28%', '45%'],
            data: sources.map((s) => ({ name: s.source, value: s.sessions, itemStyle: { color: s.color } })),
            label: { color: '#1F1A12' },
          },
          {
            name: 'GMB calls',
            type: 'pie',
            radius: ['35%', '60%'],
            center: ['72%', '45%'],
            data: sources.map((s) => ({ name: s.source, value: s.calls, itemStyle: { color: s.color } })),
            label: { color: '#1F1A12' },
          },
        ],
        title: [
          { text: 'Sessions', left: '28%', top: '88%', textAlign: 'center', textStyle: { color: '#6B6353', fontSize: 12, fontWeight: 'normal' } },
          { text: 'Calls',    left: '72%', top: '88%', textAlign: 'center', textStyle: { color: '#6B6353', fontSize: 12, fontWeight: 'normal' } },
        ],
      });
      window.addEventListener('resize', () => schart.resize());
    }

    const campEl = document.getElementById('mkCampaign');
    if (campEl && data.campaign) {
      const cchart = echarts.init(campEl);
      const c = data.campaign;
      cchart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
        legend: { textStyle: { color: '#1F1A12' } },
        grid: { left: 50, right: 60, top: 40, bottom: 40 },
        xAxis: { type: 'category', data: c.weeks, axisLabel: { color: '#6B6353' } },
        yAxis: [
          { type: 'value', name: '$ spend', axisLabel: { color: '#6B6353', formatter: '${value}' }, splitLine: { lineStyle: { color: 'rgba(31,26,18,0.08)' } } },
          { type: 'value', name: 'count', axisLabel: { color: '#6B6353' }, splitLine: { show: false } },
        ],
        series: [
          { name: 'Ad spend', type: 'bar', data: c.spend, itemStyle: { color: '#ffb547' } },
          { name: 'Leads', type: 'line', yAxisID: 1, yAxisIndex: 1, data: c.leads, itemStyle: { color: '#7c5cff' }, smooth: true },
          { name: 'Jobs booked', type: 'line', yAxisIndex: 1, data: c.jobs, itemStyle: { color: '#34d6c2' }, smooth: true },
        ],
      });
      window.addEventListener('resize', () => cchart.resize());
    }
  }
  init();
})();
