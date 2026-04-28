// Roof Cost Calculator — public landing page
// Fetches config from /api/roof-calculator, renders inline widget, links to calendar

(async function () {
  const container = document.getElementById('roof-calculator');
  if (!container) return;

  let cfg;
  try {
    const res = await fetch('/api/roof-calculator');
    const data = await res.json();
    if (!data.success || !data.calculator || !data.calculator.enabled) return;
    cfg = data.calculator;
  } catch (e) {
    return; // silently skip if API unavailable
  }

  const enabledAddOns = (cfg.addOns || []).filter(a => a.enabled);

  container.innerHTML = `
    <div class="calc-widget">
      <h3 class="calc-title">Estimate Your Roof Repair</h3>
      <div class="calc-inputs">
        <div class="calc-field">
          <label for="calc-length">RV Length <span class="calc-unit">(feet)</span></label>
          <input type="number" id="calc-length" min="1" max="120" placeholder="e.g. 32" autocomplete="off">
        </div>
        <div class="calc-field">
          <label for="calc-acs">Number of ACs</label>
          <input type="number" id="calc-acs" min="0" max="10" placeholder="e.g. 1" autocomplete="off">
        </div>
      </div>
      ${enabledAddOns.length > 0 ? `
        <div class="calc-addons">
          ${enabledAddOns.map(a => `
            <div class="calc-addon-row">
              ${a.type === 'count'
                ? `<input type="number" id="calc-addon-${a.id}" class="calc-addon-input" data-id="${a.id}" data-cost="${a.cost}" data-type="count" min="0" max="20" placeholder="0">`
                : `<input type="checkbox" id="calc-addon-${a.id}" class="calc-addon-input" data-id="${a.id}" data-cost="${a.cost}" data-type="checkbox">`
              }
              <label for="calc-addon-${a.id}">${a.label} <span class="calc-addon-cost">(+$${Number(a.cost).toFixed(2)}${a.type === 'count' ? ' each' : ''})</span></label>
            </div>
          `).join('')}
        </div>
      ` : ''}
      <div class="calc-result" id="calc-result" style="display:none;">
        <div class="calc-breakdown" id="calc-breakdown"></div>
        <div class="calc-total" id="calc-total"></div>
        <p class="calc-note">${cfg.noteText || ''}</p>
        <a href="/calendar?service=roof-repair" id="calc-cta" class="btn btn-primary calc-cta">Check Roof Availability →</a>
      </div>
    </div>
  `;

  // Wire up inputs
  function getInputs() {
    return {
      length: parseFloat(document.getElementById('calc-length').value) || 0,
      acs:    parseFloat(document.getElementById('calc-acs').value)    || 0
    };
  }

  function recalc() {
    const { length, acs } = getInputs();
    const result    = document.getElementById('calc-result');
    const breakdown = document.getElementById('calc-breakdown');
    const totalEl   = document.getElementById('calc-total');
    const ctaLink   = document.getElementById('calc-cta');

    if (!length && !acs) {
      result.style.display = 'none';
      return;
    }

    let sum = 0;
    const lines = [];
    const params = new URLSearchParams({ service: 'roof-repair' });

    if (length) {
      const v = length * cfg.costPerFoot;
      sum += v;
      lines.push(`${length} ft × $${cfg.costPerFoot}/ft = <strong>$${v.toFixed(2)}</strong>`);
      params.set('length', length);
    }
    if (acs) {
      const v = acs * cfg.costPerAC;
      sum += v;
      lines.push(`${acs} AC × $${cfg.costPerAC}/unit = <strong>$${v.toFixed(2)}</strong>`);
      params.set('acs', acs);
    }

    const addonSummary = [];
    document.querySelectorAll('.calc-addon-input').forEach(el => {
      const cost = parseFloat(el.dataset.cost) || 0;
      const label = document.querySelector(`label[for="${el.id}"]`).textContent.split('(')[0].trim();
      if (el.dataset.type === 'checkbox' && el.checked) {
        sum += cost;
        lines.push(`${label} = <strong>$${cost.toFixed(2)}</strong>`);
        addonSummary.push(`${el.dataset.id}:1`);
      } else if (el.dataset.type === 'count') {
        const qty = parseFloat(el.value) || 0;
        if (qty > 0) {
          sum += cost * qty;
          lines.push(`${label} × ${qty} = <strong>$${(cost * qty).toFixed(2)}</strong>`);
          addonSummary.push(`${el.dataset.id}:${qty}`);
        }
      }
    });

    if (addonSummary.length) params.set('addons', addonSummary.join(','));
    params.set('est', sum.toFixed(2));

    breakdown.innerHTML = lines.join('<br>');
    totalEl.innerHTML = `Estimated Total: <span class="calc-total-num">$${sum.toFixed(2)}</span>`;
    ctaLink.href = `/calendar?${params.toString()}`;
    result.style.display = 'block';
  }

  // Debounce number inputs, instant on checkbox
  let debounceTimer;
  container.addEventListener('input', e => {
    if (e.target.type === 'checkbox') { recalc(); return; }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(recalc, 180);
  });
  container.addEventListener('change', e => {
    if (e.target.type === 'checkbox') recalc();
  });
})();
