(function () {
  const data = JSON.parse(document.getElementById('marketplaceData').textContent || '{}');

  function init() {
    if (!window.echarts) return setTimeout(init, 50);
    const el = document.getElementById('mpOrders');
    if (!el || !data.orderBoard) return;
    const ob = data.orderBoard;
    const chart = echarts.init(el);
    chart.setOption({
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { textStyle: { color: '#1F1A12' } },
      grid: { left: 40, right: 20, top: 40, bottom: 40 },
      xAxis: { type: 'category', data: ob.weeks, axisLabel: { color: '#6B6353' } },
      yAxis: { type: 'value', axisLabel: { color: '#6B6353' }, splitLine: { lineStyle: { color: 'rgba(31,26,18,0.08)' } } },
      series: [
        { name: 'Open', type: 'bar', stack: 'orders', data: ob.open, itemStyle: { color: '#7c5cff' } },
        { name: 'In fab', type: 'bar', stack: 'orders', data: ob.inFab, itemStyle: { color: '#ffb547' } },
        { name: 'Ready', type: 'bar', stack: 'orders', data: ob.ready, itemStyle: { color: '#34d6c2' } },
        { name: 'Fulfilled', type: 'bar', stack: 'orders', data: ob.fulfilled, itemStyle: { color: '#4338CA' } },
      ],
    });
    window.addEventListener('resize', () => chart.resize());
  }
  init();
})();
