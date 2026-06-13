/**
 * Guardrails — validate a build before it generates noise or gets saved.
 * Returns { errors:[], warnings:[] }. Errors block a save; warnings advise.
 * hexKey is now a PATH: one or more "q,r" segments joined by "/" — the descent
 * breadcrumb of the board this build lives on (e.g. "2,-1" or "2,-1/0,1").
 */
const PATH = /^(-?\d+,-?\d+)(\/-?\d+,-?\d+)*$/;
const HEX_COLOR = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;
const CHORD = /^[A-Ga-g][#b♯♭]?(m|min|maj7|maj|m7|7|dim|aug|sus2|sus4|sus)?$/;
const KEY = /^[A-Ga-g][#b♯♭]?(\s*(minor|major|min|maj|m))?$/i;

export function validateBuild(kind, d = {}) {
  const errors = [];
  const warnings = [];
  const need = (k, msg) => { if (d[k] == null || d[k] === '' || (Array.isArray(d[k]) && !d[k].length)) errors.push(msg || `${k} is required`); };

  if (!d.name || !String(d.name).trim()) errors.push('name is required');
  if (d.hexKey && !PATH.test(String(d.hexKey).trim())) errors.push(`hexKey "${d.hexKey}" must be a path of "q,r" segments (e.g. 2,-1 or 2,-1/0,1)`);
  if (!d.hexKey) warnings.push('no hexKey — this build will be unplaced (won\'t appear on a board)');

  switch (kind) {
    case 'environment': {
      const pal = Array.isArray(d.palette) ? d.palette : [];
      const bad = pal.filter((c) => !HEX_COLOR.test(String(c).trim()));
      if (bad.length) errors.push(`palette has invalid colors: ${bad.join(', ')}`);
      if (!d.skyPrompt) warnings.push('no skyPrompt — sky art can\'t be generated');
      if (!d.groundPrompt) warnings.push('no groundPrompt — ground art can\'t be generated');
      break;
    }
    case 'music': {
      need('key'); need('progression');
      if (d.key && !KEY.test(String(d.key).trim())) warnings.push(`key "${d.key}" may not parse — use e.g. "A minor"`);
      const prog = Array.isArray(d.progression) ? d.progression : String(d.progression || '').split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      if (prog.length < 2) warnings.push('progression is very short (<2 chords) — playback will be thin');
      const badC = prog.filter((c) => !CHORD.test(c));
      if (badC.length) errors.push(`progression has unplayable chords: ${badC.join(', ')}`);
      const bpm = parseInt(d.tempoBpm, 10);
      if (d.tempoBpm && (isNaN(bpm) || bpm < 40 || bpm > 220)) warnings.push('tempoBpm should be ~40–220');
      break;
    }
    case 'object': {
      need('category');
      const s = parseFloat(d.scale);
      if (d.scale && (isNaN(s) || s <= 0 || s > 8)) warnings.push('scale should be a number ~0.3–4');
      if (!d.gltfPrompt) warnings.push('no gltfPrompt — only a primitive placeholder will render');
      break;
    }
    case 'npc': { need('role'); if (!d.greeting) warnings.push('no greeting — NPC will be silent on contact'); break; }
    case 'level': { need('objective'); if (!d.winCondition) warnings.push('no winCondition — level can\'t be completed'); break; }
    case 'storyline': { need('premise'); if (!(d.beats && d.beats.length)) warnings.push('no beats — the arc has no steps'); break; }
  }
  return { ok: errors.length === 0, errors, warnings };
}

export default { validateBuild };
