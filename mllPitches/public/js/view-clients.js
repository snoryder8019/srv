(function () {
  const data = JSON.parse(document.getElementById('clientsData').textContent || '{}');
  const f = data.featured || {};
  const events = (f.events || []).map((e) => ({ ...e, date: new Date(e.ts) })).sort((a, b) => a.date - b.date);

  const COLORS = {
    lead: '#34d6c2',
    quote: '#7c5cff',
    job: '#ffb547',
    delivered: '#4338CA',
    review: '#ff6b9b',
    followup: '#0F766E',
    campaign: '#B45309',
  };

  function init() {
    if (!window.d3) return setTimeout(init, 50);
    const host = document.getElementById('clTimeline');
    if (!host || !events.length) return;

    const width = host.clientWidth || 800;
    const height = 280;
    const margin = { top: 30, right: 24, bottom: 60, left: 24 };

    const svg = d3.select(host).append('svg').attr('width', width).attr('height', height);

    const x = d3.scaleTime()
      .domain(d3.extent(events, (d) => d.date))
      .range([margin.left, width - margin.right]);

    const baseline = height - margin.bottom;

    svg.append('line')
      .attr('x1', margin.left).attr('x2', width - margin.right)
      .attr('y1', baseline).attr('y2', baseline)
      .attr('stroke', 'rgba(31,26,18,0.18)').attr('stroke-width', 2);

    const xAxis = d3.axisBottom(x).ticks(8).tickFormat(d3.timeFormat('%b %Y'));
    svg.append('g')
      .attr('transform', `translate(0,${baseline})`)
      .call(xAxis)
      .selectAll('text').attr('fill', '#6B6353');

    const node = svg.selectAll('.cl-evt').data(events).join('g')
      .attr('class', 'cl-evt')
      .attr('transform', (d, i) => `translate(${x(d.date)}, ${baseline - 16 - (i % 3) * 26})`);

    node.append('line')
      .attr('x1', 0).attr('x2', 0)
      .attr('y1', 0).attr('y2', (d, i) => 16 + (i % 3) * 26)
      .attr('stroke', (d) => COLORS[d.type] || '#999').attr('stroke-width', 1.5);

    node.append('circle')
      .attr('r', 8)
      .attr('fill', (d) => COLORS[d.type] || '#999')
      .attr('stroke', '#FBF7EE').attr('stroke-width', 2);

    const tt = d3.select(host).append('div').attr('class', 'mll-cl-tt').style('opacity', 0);

    node.on('mouseenter', function (ev, d) {
      tt.html(`<strong>${d.title}</strong><br/><span class="mll-cl-tt__date">${d3.timeFormat('%b %d, %Y')(d.date)}</span>${d.amount ? `<br/>$${d.amount.toLocaleString()}` : ''}${d.channel ? `<br/><em>${d.channel}</em>` : ''}`)
        .style('left', `${ev.offsetX + 12}px`)
        .style('top', `${ev.offsetY + 12}px`)
        .style('opacity', 1);
    }).on('mouseleave', () => tt.style('opacity', 0));
  }
  init();
})();
