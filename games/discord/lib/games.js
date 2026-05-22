'use strict';

// Single source of truth for which games we mirror and how they're displayed.
// Order matters — voice channels and embed rows are emitted in this sequence.

module.exports = [
  { key: 'rust',     label: 'Rust',     emoji: '🟥' },
  { key: 'valheim',  label: 'Valheim',  emoji: '🛡️' },
  { key: 'windrose', label: 'Windrose', emoji: '🌅' },
  { key: 'l4d2',     label: 'L4D2',     emoji: '🧟' },
  { key: '7dtd',     label: '7DTD',     emoji: '🪓' },
  { key: 'se',       label: 'Space Eng',emoji: '🚀' },
  { key: 'palworld', label: 'Palworld', emoji: '⚔️' },
];
