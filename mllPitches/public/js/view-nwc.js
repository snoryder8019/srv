(function () {
  const data = JSON.parse(document.getElementById('nwcData').textContent || '{}');
  const C = { ar: '#4338CA', inv: '#0F766E', ap: '#B91C1C', actual: '#B45309', text: '#1F1A12', tick: '#6B6353', band: 'rgba(67, 56, 202, 0.18)', bandBg: 'rgba(251, 247, 238, 1)' };

  function init() {
    if (!window.echarts) return setTimeout(init, 50);

    let top = null, bot = null;
    const topEl = document.getElementById('nwcWaterfall');
    const botEl = document.getElementById('nwcPeg');

    function destroy() { if (top) { top.dispose(); top = null; } if (bot) { bot.dispose(); bot = null; } }

    function readControls() {
      const get = (k) => document.querySelector(`[data-control="${k}"]`)?.value;
      const num = (k) => {
        const el = document.querySelector(`[data-control="num"][data-key="${k}"]`);
        return el ? parseFloat(el.value) || 0 : 0;
      };
      return {
        variant: get('variant') || 'waterfall',
        dateRange: get('dateRange') || 'ttm',
        dso: num('dso') || data.baselineDSO || 45,
        dpo: num('dpo') || data.baselineDPO || 38,
      };
    }

    function transform(c) {
      const n = data.dateRanges?.[c.dateRange] ?? data.months.length;
      const start = Math.max(0, data.months.length - n);
      const months = data.months.slice(start);
      const arScale = c.dso / (data.baselineDSO || 45);
      const apScale = c.dpo / (data.baselineDPO || 38);
      const ar = data.ar.slice(start).map((v) => Math.round(v * arScale));
      const ap = data.ap.slice(start).map((v) => Math.round(v * apScale));
      const inventory = data.inventory.slice(start);
      const actual = data.actual.slice(start).map((v, i) => v + (ar[i] - data.ar[start + i]) - (ap[i] - data.ap[start + i]));
      return {
        months, ar, ap, inventory, actual,
        pegHigh: data.pegHigh.slice(start),
        pegLow: data.pegLow.slice(start),
      };
    }

    function render() {
      const c = readControls();
      const t = transform(c);
      destroy();

      if (c.variant === 'treemap') {
        top = echarts.init(topEl);
        const latest = t.months.length - 1;
        const ar = t.ar[latest] || 0, ap = t.ap[latest] || 0, inv = t.inventory[latest] || 0;
        top.setOption({
          backgroundColor: 'transparent',
          tooltip: { formatter: (p) => `${p.name}: $${p.value.toLocaleString()}` },
          title: { text: `Latest month (${t.months[latest]}) · DSO ${c.dso} · DPO ${c.dpo}`, textStyle: { color: C.text, fontSize: 13 } },
          series: [{
            type: 'treemap', roam: false, breadcrumb: { show: false },
            label: { color: '#FFFFFF', fontWeight: 700 }, upperLabel: { show: false },
            data: [
              { name: `AR ($${ar.toLocaleString()})`, value: ar, itemStyle: { color: C.ar } },
              { name: `Inventory ($${inv.toLocaleString()})`, value: inv, itemStyle: { color: C.inv } },
              { name: `AP ($${ap.toLocaleString()})`, value: ap, itemStyle: { color: C.ap } },
            ],
          }],
        });

        bot = echarts.init(botEl);
        const series = ['AR', 'Inventory', 'AP'];
        const heatData = [];
        t.ar.forEach((v, i) => heatData.push([i, 0, v]));
        t.inventory.forEach((v, i) => heatData.push([i, 1, v]));
        t.ap.forEach((v, i) => heatData.push([i, 2, v]));
        const max = Math.max(...heatData.map((d) => d[2]), 1);
        bot.setOption({
          backgroundColor: 'transparent',
          tooltip: { position: 'top', formatter: (p) => `${series[p.value[1]]} · ${t.months[p.value[0]]}: $${p.value[2].toLocaleString()}` },
          grid: { left: 80, right: 40, top: 30, bottom: 50 },
          xAxis: { type: 'category', data: t.months, axisLabel: { color: C.tick }, splitArea: { show: true } },
          yAxis: { type: 'category', data: series, axisLabel: { color: C.tick }, splitArea: { show: true } },
          visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 5, textStyle: { color: C.text }, inRange: { color: ['#FBF7EE', '#0F766E', '#4338CA'] } },
          series: [{ name: 'NWC', type: 'heatmap', data: heatData, label: { show: true, color: C.text, formatter: (p) => '$' + (p.value[2] / 1000).toFixed(0) + 'k' } }],
        });
        window.onresize = () => { top.resize(); bot.resize(); };
        return;
      }

      // waterfall + peg band
      top = echarts.init(topEl);
      top.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        legend: { textStyle: { color: C.text } },
        title: { text: `DSO ${c.dso} · DPO ${c.dpo}`, textStyle: { color: C.tick, fontSize: 12 }, right: 10, top: 4 },
        grid: { left: 50, right: 30, top: 40, bottom: 40 },
        xAxis: { type: 'category', data: t.months, axisLabel: { color: C.tick } },
        yAxis: { type: 'value', axisLabel: { color: C.tick, formatter: (v) => '$' + v / 1000 + 'k' } },
        series: [
          { name: 'AR', type: 'bar', stack: 'nwc', data: t.ar, itemStyle: { color: C.ar } },
          { name: 'Inventory', type: 'bar', stack: 'nwc', data: t.inventory, itemStyle: { color: C.inv } },
          { name: 'AP (offset)', type: 'bar', stack: 'nwc', data: t.ap.map((v) => -v), itemStyle: { color: C.ap } },
        ],
      });

      bot = echarts.init(botEl);
      bot.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        legend: { textStyle: { color: C.text } },
        grid: { left: 50, right: 30, top: 40, bottom: 40 },
        xAxis: { type: 'category', data: t.months, axisLabel: { color: C.tick } },
        yAxis: { type: 'value', axisLabel: { color: C.tick, formatter: (v) => '$' + v / 1000 + 'k' } },
        series: [
          { name: 'Peg band', type: 'line', data: t.pegHigh, lineStyle: { opacity: 0 }, areaStyle: { color: C.band }, stack: 'band', symbol: 'none' },
          { name: 'Peg low', type: 'line', data: t.pegLow.map((v, i) => -t.pegHigh[i] + v), lineStyle: { opacity: 0 }, areaStyle: { color: C.bandBg }, stack: 'band', symbol: 'none' },
          { name: 'Actual NWC', type: 'line', data: t.actual, itemStyle: { color: C.actual }, lineStyle: { width: 3 } },
        ],
      });
      window.onresize = () => { top.resize(); bot.resize(); };
    }

    document.querySelectorAll('.mll-controls [data-control]').forEach((el) => {
      el.addEventListener('change', render);
      el.addEventListener('input', render);
    });
    render();
  }
  init();
})();
