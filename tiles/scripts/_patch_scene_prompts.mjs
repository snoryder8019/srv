/**
 * Add scene-background prompts for the provisioned variants (euchre, mahjong,
 * craps, roulette). All inherit the shared muted/blurred STYLE suffix.
 */
import fs from 'fs';
const FILE = '/srv/tiles/services/art/scene-backgrounds.js';
const src = fs.readFileSync(FILE, 'utf8');

const anchor =
`  dominoes: 'a faraway dim casino interior, distant blurred lights, smoky low light',
  hearts: 'deep underwater abyss, faint light rays through dark water, drifting particles',
`;

const replacement =
`  dominoes: 'a faraway dim casino interior, distant blurred lights, smoky low light',
  hearts: 'deep underwater abyss, faint light rays through dark water, drifting particles',
  euchre: 'a faraway dim card lounge, distant warm blurred lights, smoky low light',
  mahjong: 'a faraway dim parlor with distant paper lanterns, soft warm blurred glow',
  craps: 'a faraway dim casino craps pit, distant blurred lights, smoky low light',
  roulette: 'a faraway dim casino floor, distant blurred golden lights, smoky low light',
`;

if (src.includes("euchre: 'a faraway dim card lounge")) { console.log('already patched'); process.exit(0); }
const n = src.split(anchor).length - 1;
if (n !== 1) throw new Error(`anchor count ${n} (expected 1)`);
fs.writeFileSync(FILE, src.replace(anchor, replacement));
console.log('patched scene prompts');
