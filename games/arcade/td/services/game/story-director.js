/**
 * StoryDirector — fires narrative beats during a run.
 *
 * Constructed from a Story doc (or null). The GameInstance calls the lifecycle
 * hooks (onRunStart, onWaveStart, onWaveCleared, onBaseChanged, onObjective,
 * onWon, onLost); the director matches beats by trigger, resolves the speaker +
 * portrait, optionally improvises the line via the NPC LLM, applies effects, and
 * returns a beat payload for the instance to emit as `story:beat`.
 *
 * Pure-ish: it never touches sockets directly. The instance owns emission so the
 * director stays testable. `once` beats fire a single time per run.
 */
import { bark } from '../ai/npc.js';

export class StoryDirector {
  constructor(story) {
    this.story = story || null;
    this.fired = new Set();                 // beat ids already shown (for `once`)
    this.charBySlug = new Map();
    for (const c of (story?.characters || [])) this.charBySlug.set(c.slug, c);
  }

  get enabled() { return !!(this.story && this.story.beats && this.story.beats.length); }

  _speaker(slug) {
    return this.charBySlug.get(slug) || { slug: slug || 'vesk', name: 'Vesk', role: 'Hexwarden', color: '#33ddff', portraitUrl: '/assets/img/vesk-portrait.png' };
  }

  // Find beats whose trigger matches; respect `once`.
  _match(predicate) {
    if (!this.enabled) return [];
    const hits = [];
    for (const b of this.story.beats) {
      if (b.trigger?.once && this.fired.has(b.id)) continue;
      if (predicate(b)) hits.push(b);
    }
    return hits;
  }

  // Turn a matched beat into an emittable payload (and apply effects via applyFx).
  async _build(beat, ctx, applyFx) {
    this.fired.add(beat.id);
    const sp = this._speaker(beat.speaker);
    let lines = (beat.lines || []).filter(Boolean);
    if (beat.improvise) {
      // improvise a single line in the speaker's persona; scripted lines seed/fallback
      const line = await bark('story', {
        persona: sp.persona, name: sp.name, role: sp.role,
        seed: lines[0] || '', ...ctx,
      }).catch(() => null);
      if (line) lines = [line];
    }
    if (!lines.length) lines = ['...'];

    const fx = beat.effects || {};
    if (applyFx) applyFx(fx);

    return {
      id: beat.id,
      speaker: { slug: sp.slug, name: sp.name, role: sp.role, color: sp.color, portraitUrl: sp.portraitUrl },
      lines,
      pause: !!fx.pauseUntilDismissed,
      effects: { grantCurrency: fx.grantCurrency || 0, healBase: fx.healBase || 0 },
    };
  }

  // ---- lifecycle hooks: each returns an array of beat payloads (often 0 or 1) ----
  async onRunStart(ctx, applyFx) {
    const beats = this._match((b) => b.trigger?.type === 'run-start');
    return Promise.all(beats.map((b) => this._build(b, ctx, applyFx)));
  }
  async onWaveStart(wave, ctx, applyFx) {
    const beats = this._match((b) => b.trigger?.type === 'wave-start' && (b.trigger.wave || 0) === wave);
    return Promise.all(beats.map((b) => this._build(b, ctx, applyFx)));
  }
  async onWaveCleared(wave, ctx, applyFx) {
    const beats = this._match((b) => b.trigger?.type === 'wave-cleared' && (b.trigger.wave || 0) === wave);
    return Promise.all(beats.map((b) => this._build(b, ctx, applyFx)));
  }
  async onBaseChanged(pct, ctx, applyFx) {
    const beats = this._match((b) => b.trigger?.type === 'base-below' && pct <= (b.trigger.threshold ?? 50));
    return Promise.all(beats.map((b) => this._build(b, ctx, applyFx)));
  }
  async onObjective(objectiveId, ok, ctx, applyFx) {
    const want = ok ? 'objective-complete' : 'objective-failed';
    const beats = this._match((b) => b.trigger?.type === want && (!b.trigger.objectiveId || b.trigger.objectiveId === objectiveId));
    return Promise.all(beats.map((b) => this._build(b, ctx, applyFx)));
  }
  async onWon(ctx, applyFx) {
    const beats = this._match((b) => b.trigger?.type === 'run-won');
    return Promise.all(beats.map((b) => this._build(b, ctx, applyFx)));
  }
  async onLost(ctx, applyFx) {
    const beats = this._match((b) => b.trigger?.type === 'run-lost');
    return Promise.all(beats.map((b) => this._build(b, ctx, applyFx)));
  }
}

export default { StoryDirector };
