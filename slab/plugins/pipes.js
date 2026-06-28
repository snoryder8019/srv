/**
 * Slab — Content Pipes (Handlebars)
 * ----------------------------------
 * A safe, sandboxed mini-templating layer for TENANT-AUTHORED content.
 *
 * Why Handlebars and not EJS: the public site renders stored copy/section HTML
 * with `<%- value %>`. EJS compiles trusted TEMPLATE FILES, never tenant data —
 * running `ejs.render()` on a tenant string would hand every tenant arbitrary
 * server-side JS (RCE). Handlebars is logicless: a tenant can ONLY invoke the
 * helpers we register here, so compiling tenant strings is safe. Modern
 * Handlebars (>=4.6) also blocks prototype access by default.
 *
 *   <%- %>  → trusted template layer (our .ejs files)
 *   {{ }}   → untrusted tenant-content layer (this module)
 *
 * Grammar (real Handlebars):
 *   {{brand.name}}                      expression — HTML-escaped
 *   {{color.primary}} {{font.heading}}  design vars
 *   {{copy "hero_sub"}}                 reuse another copy block
 *   {{form "contact-intake"}}           helper — inline form embed
 *   {{img "logo_primary" alt="Logo"}}   brand image
 *
 * Usage from a route (mutates copy values + node strings in place):
 *   import { applyPipes } from '../plugins/pipes.js';
 *   await applyPipes({ db: req.db, tenant: req.tenant, design, copy, nodes: [customSections] });
 */

import Handlebars from 'handlebars';

// ── Reference scanners (decide what to prefetch before sync compile) ──────────
const FORM_REF = /\{\{\s*form\s+["']([\w-]+)["']/g;
const IMG_REF  = /\{\{\s*img\s+["']([\w-]+)["']/g;

function hasPipes(s) { return typeof s === 'string' && s.indexOf('{{') >= 0; }

// Only recurse into Arrays and plain objects — never Date/ObjectId/Buffer etc.
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && (v.constructor === Object || v.constructor === undefined);
}

function collectStrings(node, out, depth = 0) {
  if (depth > 6 || node == null) return;
  if (typeof node === 'string') { if (hasPipes(node)) out.push(node); return; }
  if (Array.isArray(node)) { for (const v of node) collectStrings(v, out, depth + 1); return; }
  if (isPlainObject(node)) { for (const k of Object.keys(node)) collectStrings(node[k], out, depth + 1); }
}

// ── Inline form embed (the "inline partial" — one JS renderer shared by all) ──
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inputTypeFor(t) {
  return ({ number: 'number', email: 'email', url: 'url', date: 'date', color: 'color' })[t] || 'text';
}

function renderFormFields(form) {
  if (!form) return '<!-- pipe: form not found or inactive -->';
  const slug = esc(form.slug);
  let h = `<form class="pipe-form" data-pipe-form="${slug}">`;
  h += `<div class="pipe-form-head"><strong>${esc(form.name)}</strong>`;
  if (form.description) h += `<p>${esc(form.description)}</p>`;
  h += `</div>`;

  for (const f of (form.fields || [])) {
    if (f.type === 'heading') {
      h += `<div class="pf-heading"><span>${esc(f.label)}</span></div>`;
      continue;
    }
    const cond = f.conditional?.fieldKey
      ? ` data-cond-field="${esc(f.conditional.fieldKey)}" data-cond-op="${esc(f.conditional.operator)}" data-cond-val="${esc(f.conditional.value)}"`
      : '';
    h += `<div class="pf-field${f.width === 'half' ? ' half' : ''}"${cond}>`;
    h += `<label>${esc(f.label)}${f.required ? ' <span class="pf-req">*</span>' : ''}</label>`;
    if (f.helpText) h += `<div class="pf-help">${esc(f.helpText)}</div>`;
    const req = f.required ? ' required' : '';
    const name = esc(f.key);
    if (f.type === 'textarea') {
      h += `<textarea name="${name}" placeholder="${esc(f.placeholder || '')}"${req}></textarea>`;
    } else if (f.type === 'select') {
      h += `<select name="${name}"${req}><option value="">Select...</option>`;
      for (const o of (f.options || [])) h += `<option value="${esc(o.value)}">${esc(o.label)}</option>`;
      h += `</select>`;
    } else if (f.type === 'radio' || f.type === 'checkbox') {
      for (const o of (f.options || [])) {
        h += `<label class="pf-opt"><input type="${f.type}" name="${name}" value="${esc(o.value)}"> ${esc(o.label)}</label>`;
      }
    } else {
      h += `<input type="${inputTypeFor(f.type)}" name="${name}" placeholder="${esc(f.placeholder || '')}"${req}>`;
    }
    h += `</div>`;
  }
  h += `<button type="submit" class="pf-submit">Submit</button>`;
  h += `</form>`;
  return h + PIPE_FORM_BOOTSTRAP;
}

// Idempotent: styles + delegated submit/conditional handlers install exactly once
// per page, no matter how many forms are embedded.
const PIPE_FORM_BOOTSTRAP = `<script>(function(){
  if (window.__pipeFormsInit) return; window.__pipeFormsInit = true;
  var css = '.pipe-form{display:grid;grid-template-columns:1fr 1fr;gap:12px 14px;max-width:640px;margin:18px 0;padding:22px;border:1px solid var(--border,#e3e3e3);border-radius:12px;background:var(--surface,#fff)}'
    +'.pipe-form .pipe-form-head{grid-column:span 2}.pipe-form .pipe-form-head strong{font-size:1.1rem}.pipe-form .pipe-form-head p{margin:4px 0 0;opacity:.7;font-size:.88rem}'
    +'.pipe-form .pf-field{grid-column:span 2;display:flex;flex-direction:column;gap:5px}.pipe-form .pf-field.half{grid-column:span 1}'
    +'.pipe-form label{font-size:.82rem;font-weight:600}.pipe-form .pf-help{font-size:.72rem;opacity:.65}.pipe-form .pf-req{color:#c0392b}'
    +'.pipe-form .pf-heading{grid-column:span 2;border-bottom:1px solid var(--border,#e3e3e3);padding-bottom:5px;margin-top:8px}.pipe-form .pf-heading span{text-transform:uppercase;letter-spacing:.6px;font-size:.74rem;opacity:.6}'
    +'.pipe-form input,.pipe-form textarea,.pipe-form select{padding:10px 12px;border:1px solid var(--border,#e3e3e3);border-radius:7px;font:inherit;width:100%}'
    +'.pipe-form .pf-opt{flex-direction:row;align-items:center;gap:7px;font-weight:400}.pipe-form .pf-opt input{width:auto}'
    +'.pipe-form .pf-submit{grid-column:span 2;padding:12px;border:0;border-radius:8px;background:var(--primary,var(--color-primary,#1C2B4A));color:#fff;font-weight:600;cursor:pointer}'
    +'@media(max-width:520px){.pipe-form .pf-field.half{grid-column:span 2}}';
  var s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  function conds(form){ form.querySelectorAll('[data-cond-field]').forEach(function(el){
    var inp = form.querySelector('[name="'+el.dataset.condField+'"]'); var a = inp?inp.value:''; var op=el.dataset.condOp,v=el.dataset.condVal,show=false;
    if(op==='eq')show=a===v; else if(op==='neq')show=a!==v; else if(op==='contains')show=a.toLowerCase().indexOf(v.toLowerCase())>=0; el.style.display=show?'':'none';
  }); }
  document.addEventListener('input', function(e){ var f=e.target.closest&&e.target.closest('.pipe-form'); if(f)conds(f); });
  document.querySelectorAll('.pipe-form').forEach(conds);
  document.addEventListener('submit', function(e){
    var form = e.target.closest && e.target.closest('.pipe-form'); if(!form) return; e.preventDefault();
    var slug = form.getAttribute('data-pipe-form'); var data={};
    new FormData(form).forEach(function(v,k){ if(data[k]){ if(!Array.isArray(data[k]))data[k]=[data[k]]; data[k].push(v);} else data[k]=v; });
    var btn = form.querySelector('.pf-submit'); if(btn){btn.disabled=true;btn.textContent='Submitting...';}
    fetch('/forms/'+slug+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({data:data,respondentName:data.name||data.fullName||'',respondentEmail:data.email||''})})
    .then(function(r){return r.json();}).then(function(res){
      if(res.ok){ form.innerHTML='<div class="pipe-form-head"><strong>Thank you!</strong><p>Your response has been received.</p></div>'; }
      else { if(btn){btn.disabled=false;btn.textContent='Submit';} alert(res.error||'Submit failed'); }
    }).catch(function(){ if(btn){btn.disabled=false;btn.textContent='Submit';} alert('Submit failed'); });
  });
})();</script>`;

// ── Build an isolated Handlebars env + context for one render pass ────────────
async function buildPipeEnv({ db, tenant, design, copy, strings }) {
  const env = Handlebars.create(); // isolated — never pollute the global registry

  // Map design keys → friendly namespaces: color_primary → color.primary
  const color = {}, font = {};
  for (const [k, v] of Object.entries(design || {})) {
    if (k.startsWith('color_')) color[k.slice(6)] = v;
    else if (k.startsWith('font_')) font[k.slice(5)] = v;
  }

  // Prefetch everything the helpers need (helpers are synchronous).
  const formSlugs = new Set(), imgSlots = new Set();
  for (const s of strings) {
    let m;
    FORM_REF.lastIndex = 0; while ((m = FORM_REF.exec(s))) formSlugs.add(m[1]);
    IMG_REF.lastIndex = 0;  while ((m = IMG_REF.exec(s)))  imgSlots.add(m[1]);
  }

  const formMap = {}, imgMap = {};
  if (db && formSlugs.size) {
    const forms = await db.collection('onboarding_forms')
      .find({ slug: { $in: [...formSlugs] }, status: 'active' }).toArray();
    for (const f of forms) formMap[f.slug] = f;
  }
  if (db && imgSlots.size) {
    const imgs = await db.collection('brand_images')
      .find({ slot: { $in: [...imgSlots] } }).toArray();
    for (const i of imgs) imgMap[i.slot] = i.url;
  }

  env.registerHelper('form', (slug) => new env.SafeString(renderFormFields(formMap[slug])));
  env.registerHelper('copy', (key) => new env.SafeString(copy?.[key] ?? ''));
  env.registerHelper('img', (slot, opts) => {
    const url = imgMap[slot];
    if (!url) return '';
    return new env.SafeString(`<img class="pipe-img" src="${esc(url)}" alt="${esc(opts?.hash?.alt || '')}">`);
  });

  const context = { brand: tenant?.brand || {}, color, font, design: design || {} };
  return { env, context };
}

function renderOne(env, str, context) {
  try { return env.compile(str, { noEscape: false })(context); }
  catch { return str; } // half-typed/malformed token must never blank the page
}

function rewriteDeep(node, env, context, depth = 0) {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const v = node[i];
      if (typeof v === 'string') { if (hasPipes(v)) node[i] = renderOne(env, v, context); }
      else rewriteDeep(v, env, context, depth + 1);
    }
    return;
  }
  if (isPlainObject(node)) {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string') { if (hasPipes(v)) node[k] = renderOne(env, v, context); }
      else rewriteDeep(v, env, context, depth + 1);
    }
  }
}

/**
 * Resolve {{ }} pipes across a tenant's content. Mutates `copy` and every object
 * in `nodes` IN PLACE. Cheap no-op when nothing contains "{{".
 * @param {object} args
 * @param {object} args.db        tenant db (req.db)
 * @param {object} args.tenant    req.tenant (provides brand)
 * @param {object} args.design    flattened design map
 * @param {object} [args.copy]    copy key→value map (rewritten in place)
 * @param {Array}  [args.nodes]   extra objects/arrays to deep-rewrite (sections, blocks)
 * @param {string} [args.mode]    'public' | 'admin' — reserved for gated helpers
 */
export async function applyPipes({ db, tenant, design, copy, nodes = [], mode = 'public' } = {}) {
  const strings = [];
  if (copy) collectStrings(copy, strings);
  for (const n of nodes) collectStrings(n, strings);
  if (!strings.length) return; // nothing to resolve

  const { env, context } = await buildPipeEnv({ db, tenant, design, copy, strings });
  if (copy) rewriteDeep(copy, env, context);
  for (const n of nodes) rewriteDeep(n, env, context);
}

export default { applyPipes };
