/**
 * Enemy archetypes. Pure data - tune here as the wave designer grows.
 *
 * Balance pass 2: the board is now large (radius 16) and viewed zoomed-out, so
 * units read as fast streaks. Speeds cut ~45% from the last pass for a slow,
 * readable march; HP nudged so they still take real fire. Tune freely.
 *
 * Analysis fields (shown in the tactical-pause readout):
 *   aggro    — what the unit prioritizes / how it behaves
 *   ability  — its special trick
 *   threat   — coarse 1–5 danger rating for quick triage
 *   armor    — flat damage reduction per hit (0 = none)
 *   ground   — true = walks the lanes (grunt/machine), false = flies
 */
export const ENEMY_TYPES = {
  basic:   { hp: 34,  speed: 0.5, reward: 5,  color: 0x88ff88, ground: true,  threat: 1, armor: 0, aggro: 'Beelines for the core', ability: 'None' },
  fast:    { hp: 20,  speed: 1.0, reward: 7,  color: 0xffff66, ground: true,  threat: 2, armor: 0, aggro: 'Rushes the shortest lane', ability: 'Sprint — hard to track' },
  tank:    { hp: 140, speed: 0.3, reward: 15, color: 0xff6644, ground: true,  threat: 4, armor: 3, aggro: 'Soaks fire, ignores chip damage', ability: 'Armor — reduces each hit' },

  // ground "grunt/machine" line used by Siege mode
  grunt:   { hp: 44,  speed: 0.55, reward: 5,  color: 0x9fd06a, ground: true,  threat: 1, armor: 0, aggro: 'Marches straight for the core', ability: 'None' },
  runner:  { hp: 28,  speed: 1.05, reward: 8,  color: 0xffd24a, ground: true,  threat: 2, armor: 0, aggro: 'Flanks fast down open lanes', ability: 'Sprint burst' },
  machine: { hp: 210, speed: 0.24, reward: 20, color: 0xc0563a, ground: true, threat: 5, armor: 6, aggro: 'Grinds forward, shrugs off hits', ability: 'Heavy plating' },
  flyer:   { hp: 38,  speed: 0.72, reward: 9,  color: 0x66ccff, ground: false, threat: 3, armor: 0, aggro: 'Ignores the maze — flies over cover', ability: 'Flight — skips obstacles' },

  // a sneaky unit that visually blends with the crowd (Where's-Waldo objective)
  infiltrator: { hp: 70, speed: 0.6, reward: 30, color: 0x9fd06a, ground: true, threat: 5, armor: 0, disguise: 'grunt',
    aggro: 'Hides in the pack, slips to the core', ability: 'Disguise — looks like a grunt until spotted' },
};

export default ENEMY_TYPES;
