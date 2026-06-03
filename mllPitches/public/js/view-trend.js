(function () {
  const data = JSON.parse(document.getElementById('trendData').textContent || '{}');
  const C = { text: '#1F1A12', tick: '#6B6353', grid: '#D8CFB8', accent: '#4338CA', accent2: '#0F766E', warn: '#B45309' };
  function init() {
    if (!window.d3) return setTimeout(init, 50);
    const container = document.getElementById('trendChart');

    function readControls() {
      const get = (k) => document.querySelector(`[data-control="${k}"]`)?.value;
      const numEl = document.querySelector('[data-control="num"][data-key="growthAdj"]');
      return {
        variant: get('variant') || 'cone',
        viewSet: get('viewSet') || 'revenue',
        dateRange: get('dateRange') || '5y',
        growthAdj: parseFloat(numEl?.value || '0'),
      };
    }

    function transform(c) {
      // Override JSON colors with theme colors
      const metricColors = { revenue: C.accent2, 'gross-margin': C.accent, ebitda: C.warn };
      const metric = data.metricMultipliers?.[c.viewSet] || { value: 1, label: 'Revenue', color: C.accent2 };
      metric.color = metricColors[c.viewSet] || metric.color;
      const threshold = data.dateThresholds?.[c.dateRange];
      const parseDate = d3.timeParse('%Y-%m');
      const fcMul = 1 + c.growthAdj / 100;

      const all = [...(data.historical || []), ...(data.forecast || [])].map((d) => {
        const date = parseDate(d.period);
        const m = d.kind === 'forecast' ? metric.value * fcMul : metric.value;
        return { ...d, date, value: Math.round(d.value * m), low: d.low ? Math.round(d.low * m) : undefined, high: d.high ? Math.round(d.high * m) : undefined };
      });
      const filtered = threshold ? all.filter((d) => d.period >= threshold) : all;
      return { series: filtered, metric };
    }

    function render() {
      const c = readControls();
      const { series, metric } = transform(c);
      container.innerHTML = '';

      const width = container.clientWidth || 800;
      const height = 380;
      const margin = { top: 30, right: 30, bottom: 60, left: 60 };
      const svg = d3.select(container).append('svg').attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

      svg.append('text').attr('x', margin.left).attr('y', 18)
        .attr('fill', metric.color).attr('font-weight', 700).attr('font-size', 13)
        .text(`${metric.label}${c.growthAdj ? ` · ${c.growthAdj > 0 ? '+' : ''}${c.growthAdj}% forecast adj` : ''}`);

      if (!series.length) return;

      const x = d3.scaleTime().domain(d3.extent(series, (d) => d.date)).range([margin.left, width - margin.right]);
      const yMax = d3.max(series, (d) => d.high || d.value) || 1;
      const y = d3.scaleLinear().domain([0, yMax * 1.1]).range([height - margin.bottom, margin.top]);

      svg.append('g').attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %y')))
        .selectAll('text').attr('fill', C.tick);
      svg.append('g').attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).ticks(6).tickFormat((v) => '$' + (v / 1000).toFixed(0) + 'k'))
        .selectAll('text').attr('fill', C.tick);
      svg.selectAll('.domain, .tick line').attr('stroke', C.grid);

      if (c.variant === 'stream') {
        const hist = series.filter((d) => d.kind === 'actual');
        const fc = series.filter((d) => d.kind === 'forecast');
        const area = d3.area().x((d) => x(d.date)).y0(y(0)).y1((d) => y(d.value)).curve(d3.curveMonotoneX);
        svg.append('path').datum(hist).attr('d', area).attr('fill', metric.color).attr('fill-opacity', 0.25);
        svg.append('path').datum(fc).attr('d', area).attr('fill', C.accent).attr('fill-opacity', 0.25);
        const line = d3.line().x((d) => x(d.date)).y((d) => y(d.value)).curve(d3.curveMonotoneX);
        svg.append('path').datum(series).attr('d', line).attr('fill', 'none').attr('stroke', C.text).attr('stroke-width', 1.5);

        const readout = svg.append('text').attr('x', margin.left).attr('y', height - margin.bottom + 50)
          .attr('fill', C.text).attr('font-size', 12).text('Drag to select a window');
        const brush = d3.brushX()
          .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]])
          .on('end', ({ selection }) => {
            if (!selection) return readout.text('Drag to select a window');
            const [a, b] = selection.map(x.invert);
            const pts = series.filter((d) => d.date >= a && d.date <= b);
            if (!pts.length) return readout.text('Empty window');
            const first = pts[0].value, last = pts[pts.length - 1].value;
            const pct = (((last - first) / first) * 100).toFixed(1);
            readout.text(`${d3.timeFormat('%b %y')(a)} → ${d3.timeFormat('%b %y')(b)} · ${pts.length} pts · Δ ${pct}%`);
          });
        svg.append('g').attr('class', 'brush').call(brush);
        svg.selectAll('.brush .selection').attr('fill', 'rgba(180, 83, 9, 0.18)').attr('stroke', C.warn);
        return;
      }

      // cone
      const area = d3.area().x((d) => x(d.date)).y0((d) => y(d.low || d.value)).y1((d) => y(d.high || d.value)).curve(d3.curveMonotoneX);
      const forecast = series.filter((d) => d.kind === 'forecast');
      svg.append('path').datum(forecast).attr('d', area).attr('fill', 'rgba(67, 56, 202, 0.18)');

      const line = d3.line().x((d) => x(d.date)).y((d) => y(d.value)).curve(d3.curveMonotoneX);
      svg.append('path').datum(series).attr('d', line).attr('fill', 'none').attr('stroke', metric.color).attr('stroke-width', 2.5);

      svg.selectAll('circle').data(series).enter().append('circle')
        .attr('cx', (d) => x(d.date)).attr('cy', (d) => y(d.value))
        .attr('r', 3.5).attr('fill', (d) => d.kind === 'forecast' ? C.accent : metric.color);

      const legend = svg.append('g').attr('transform', `translate(${width - 220},${margin.top})`);
      legend.append('rect').attr('width', 16).attr('height', 10).attr('fill', metric.color);
      legend.append('text').attr('x', 22).attr('y', 10).attr('fill', C.text).text('Historical actual');
      legend.append('rect').attr('y', 18).attr('width', 16).attr('height', 10).attr('fill', 'rgba(67, 56, 202, 0.45)');
      legend.append('text').attr('x', 22).attr('y', 28).attr('fill', C.text).text('Forecast cone');
    }

    document.querySelectorAll('.mll-controls [data-control]').forEach((el) => {
      el.addEventListener('change', render);
      el.addEventListener('input', render);
    });
    render();
    let t; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(render, 120); });
  }
  init();
})();
