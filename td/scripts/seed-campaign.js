/**
 * Seed the "Prime" campaign: ~5 escalating Levels + one Story arc, both
 * attached to an existing Map. Idempotent — upserts by unique slug, so it is
 * safe to run repeatedly (re-running updates content in place, never dupes).
 *
 *   node scripts/seed-campaign.js
 *
 * Targeting: picks an existing Map (prefers status 'approved', else the first
 * Map by creation order). If no Map exists it logs a message and exits cleanly.
 *
 * All enemy `type` strings below exist in both EnemyType.js and the renderer
 * SPEC table (enemy.js): basic, fast, tank, grunt, runner, machine, flyer,
 * flyer2, infiltrator — so every group actually renders.
 */
import mongoose from 'mongoose';
import { connectDb } from '../services/db.js';
import GameMap from '../api/v1/models/Map.js';
import Level from '../api/v1/models/Level.js';
import Story from '../api/v1/models/Story.js';

// ---------------------------------------------------------------------------
// LEVELS — escalating difficulty. mapId is filled in at runtime from the
// chosen board, so the static data here is map-agnostic.
// ---------------------------------------------------------------------------
function buildLevels(mapId) {
  return [
    {
      name: 'First Contact',
      slug: 'campaign-1-first-contact',
      description:
        'The outer pickets light up. A trickle of probe-walkers test the line. ' +
        'Plenty of scrap to work with — learn the board before it gets loud.',
      mapId,
      order: 1,
      status: 'approved',
      modifiers: {
        startingCurrency: 350,
        baseHealth: 100,
        enemyHpMult: 0.9,
        enemySpeedMult: 1.0,
        rewardMult: 1.2,
      },
      waves: [
        { enemies: [{ type: 'basic', count: 6, delayMs: 1600 }], intermissionMs: 6000 },
        { enemies: [{ type: 'basic', count: 8, delayMs: 1300 }], intermissionMs: 6000 },
        {
          enemies: [
            { type: 'grunt', count: 6, delayMs: 1200 },
            { type: 'basic', count: 6, delayMs: 1000 },
          ],
          intermissionMs: 7000,
        },
        {
          enemies: [
            { type: 'grunt', count: 10, delayMs: 1000 },
            { type: 'fast', count: 3, delayMs: 900 },
          ],
          intermissionMs: 7000,
        },
      ],
    },
    {
      name: 'Swarm',
      slug: 'campaign-2-swarm',
      description:
        'They stop knocking. Light, fast chassis pour in from the spawn line — ' +
        'more bodies than you have bullets unless your placement is tight.',
      mapId,
      order: 2,
      status: 'approved',
      modifiers: {
        startingCurrency: 300,
        baseHealth: 100,
        enemyHpMult: 1.0,
        enemySpeedMult: 1.15,
        rewardMult: 1.1,
      },
      waves: [
        { enemies: [{ type: 'fast', count: 12, delayMs: 700 }], intermissionMs: 5500 },
        {
          enemies: [
            { type: 'runner', count: 14, delayMs: 600 },
            { type: 'fast', count: 6, delayMs: 700 },
          ],
          intermissionMs: 5500,
        },
        {
          enemies: [
            { type: 'fast', count: 16, delayMs: 550 },
            { type: 'grunt', count: 8, delayMs: 900 },
          ],
          intermissionMs: 6000,
        },
        {
          enemies: [
            { type: 'runner', count: 20, delayMs: 450 },
            { type: 'infiltrator', count: 6, delayMs: 1100 },
          ],
          intermissionMs: 6500,
        },
        {
          enemies: [
            { type: 'fast', count: 24, delayMs: 400 },
            { type: 'runner', count: 12, delayMs: 500 },
          ],
          intermissionMs: 7000,
        },
      ],
    },
    {
      name: 'Heavy Metal',
      slug: 'campaign-3-heavy-metal',
      description:
        'The swarm was a softening run. Now the hulls roll forward — armoured ' +
        'tanks and siege-machines that soak everything you throw and keep walking.',
      mapId,
      order: 3,
      status: 'approved',
      modifiers: {
        startingCurrency: 320,
        baseHealth: 100,
        enemyHpMult: 1.5,
        enemySpeedMult: 0.95,
        rewardMult: 1.15,
      },
      waves: [
        {
          enemies: [
            { type: 'tank', count: 4, delayMs: 2200 },
            { type: 'grunt', count: 8, delayMs: 1000 },
          ],
          intermissionMs: 7000,
        },
        {
          enemies: [
            { type: 'tank', count: 6, delayMs: 2000 },
            { type: 'fast', count: 10, delayMs: 700 },
          ],
          intermissionMs: 7000,
        },
        {
          enemies: [
            { type: 'machine', count: 3, delayMs: 2800 },
            { type: 'tank', count: 4, delayMs: 2000 },
          ],
          intermissionMs: 8000,
        },
        {
          enemies: [
            { type: 'machine', count: 5, delayMs: 2400 },
            { type: 'grunt', count: 12, delayMs: 800 },
            { type: 'runner', count: 10, delayMs: 600 },
          ],
          intermissionMs: 8500,
        },
      ],
    },
    {
      name: 'Air Raid',
      slug: 'campaign-4-air-raid',
      description:
        'Contacts on the high band. Flock-class flyers slip the ground lanes ' +
        'entirely — if your line can only see the floor, the sky will bleed you out.',
      mapId,
      order: 4,
      status: 'approved',
      modifiers: {
        startingCurrency: 340,
        baseHealth: 100,
        enemyHpMult: 1.4,
        enemySpeedMult: 1.1,
        rewardMult: 1.2,
      },
      waves: [
        {
          enemies: [
            { type: 'flyer', count: 8, delayMs: 900 },
            { type: 'grunt', count: 8, delayMs: 1000 },
          ],
          intermissionMs: 7000,
        },
        {
          enemies: [
            { type: 'flyer2', count: 10, delayMs: 800 },
            { type: 'fast', count: 12, delayMs: 600 },
          ],
          intermissionMs: 7000,
        },
        {
          enemies: [
            { type: 'flyer', count: 10, delayMs: 800 },
            { type: 'flyer2', count: 10, delayMs: 800 },
            { type: 'tank', count: 4, delayMs: 2000 },
          ],
          intermissionMs: 8000,
        },
        {
          enemies: [
            { type: 'flyer2', count: 14, delayMs: 650 },
            { type: 'machine', count: 4, delayMs: 2400 },
            { type: 'runner', count: 14, delayMs: 500 },
          ],
          intermissionMs: 8500,
        },
        {
          enemies: [
            { type: 'flyer', count: 16, delayMs: 600 },
            { type: 'flyer2', count: 16, delayMs: 600 },
          ],
          intermissionMs: 9000,
        },
      ],
    },
    {
      name: 'The Onslaught',
      slug: 'campaign-5-the-onslaught',
      description:
        'Everything they have, all at once, all lanes, all bands. No reserves are ' +
        'coming for either side. Hold the prime relay or lose the system.',
      mapId,
      order: 5,
      status: 'approved',
      modifiers: {
        startingCurrency: 250,
        baseHealth: 100,
        enemyHpMult: 1.8,
        enemySpeedMult: 1.2,
        rewardMult: 1.6,
      },
      waves: [
        {
          enemies: [
            { type: 'fast', count: 20, delayMs: 450 },
            { type: 'grunt', count: 14, delayMs: 700 },
            { type: 'flyer', count: 8, delayMs: 800 },
          ],
          intermissionMs: 7000,
        },
        {
          enemies: [
            { type: 'tank', count: 8, delayMs: 1800 },
            { type: 'machine', count: 5, delayMs: 2400 },
            { type: 'runner', count: 18, delayMs: 450 },
          ],
          intermissionMs: 7500,
        },
        {
          enemies: [
            { type: 'flyer', count: 14, delayMs: 600 },
            { type: 'flyer2', count: 14, delayMs: 600 },
            { type: 'infiltrator', count: 10, delayMs: 900 },
          ],
          intermissionMs: 8000,
        },
        {
          enemies: [
            { type: 'machine', count: 8, delayMs: 2000 },
            { type: 'tank', count: 10, delayMs: 1600 },
            { type: 'fast', count: 24, delayMs: 350 },
          ],
          intermissionMs: 8500,
        },
        {
          enemies: [
            { type: 'machine', count: 6, delayMs: 2200 },
            { type: 'tank', count: 8, delayMs: 1600 },
            { type: 'flyer', count: 16, delayMs: 550 },
            { type: 'flyer2', count: 16, delayMs: 550 },
            { type: 'runner', count: 30, delayMs: 300 },
          ],
          intermissionMs: 10000,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// STORY — the "Prime" arc. Two voices: Commander Vesk (calm authority) and
// Scout-7, a forward recon drone reading enemy intel. mapId/mapSlug are filled
// in at runtime.
// ---------------------------------------------------------------------------
function buildStory(mapId, mapSlug) {
  return {
    title: 'Campaign: Prime Relay',
    slug: 'campaign-prime',
    synopsis:
      'The Prime Relay is the last node tying this sector to the core worlds. ' +
      'Commander Vesk holds the wall; Scout-7 reads the dark ahead of it. ' +
      'Between First Contact and the Onslaught, the only plan is: do not let them past.',
    mapId,
    mapSlug,
    authorName: 'system',
    status: 'approved',
    characters: [
      {
        slug: 'vesk',
        name: 'Cmdr. Vesk',
        role: 'Field Commander',
        color: '#33ddff',
        portraitUrl: '/assets/img/story/vesk.png',
        portraitPrompt:
          'headset bust portrait of a weathered human field commander, short ' +
          'iron-grey hair, scarred jaw, glowing cyan tactical headset and throat ' +
          'mic, dark armored collar, dim command-bunker backlight, cinematic ' +
          'rim light, sci-fi military, head and shoulders, neutral resolute expression',
        persona:
          'Veteran field commander. Calm, dry, economical. Never panics, never ' +
          'sugarcoats. Speaks in short tactical sentences. Respects the player as a gunline.',
      },
      {
        slug: 'scout-7',
        name: 'Scout-7',
        role: 'Recon Drone / Enemy Intel',
        color: '#9cff5a',
        portraitUrl: '/assets/img/story/scout-7.png',
        portraitPrompt:
          'headset bust portrait of a sleek autonomous recon drone, single ' +
          'glowing green optic sensor, segmented matte-black chassis, antenna ' +
          'array, faint scan-line HUD reflections, sci-fi, head and shoulders ' +
          'framing, cold green key light',
        persona:
          'Forward recon drone. Clipped, data-first, slightly inhuman cadence. ' +
          'Reports counts, vectors and threat bands before they hit the wall. ' +
          'Occasionally darkly funny about the odds.',
      },
    ],
    beats: [
      {
        id: 'intro',
        trigger: { type: 'run-start', once: true },
        speaker: 'vesk',
        lines: [
          "This is the Prime Relay. If it falls, the sector goes dark for good.",
          "I've routed you an emergency scrap allotment. Spend it well — there is no resupply.",
          "Scout-7 has eyes forward. Listen to it. Hold the line.",
        ],
        improvise: false,
        effects: { grantCurrency: 100, healBase: 0, pauseUntilDismissed: true },
      },
      {
        id: 'first-wave',
        trigger: { type: 'wave-start', wave: 1, once: true },
        speaker: 'scout-7',
        lines: [
          "Contact. Probe-walkers, light armor, single file.",
          "They are measuring you. Make the measurement expensive.",
        ],
        improvise: false,
        effects: { grantCurrency: 0, healBase: 0, pauseUntilDismissed: false },
      },
      {
        id: 'swarm-warning',
        trigger: { type: 'wave-start', wave: 3, once: true },
        speaker: 'scout-7',
        lines: [
          "Threat band shifting. Mass of fast chassis inbound — count climbing.",
          "Coverage over kill-power, Commander. Plug the gaps or they slip the wall.",
        ],
        improvise: false,
        effects: { grantCurrency: 0, healBase: 0, pauseUntilDismissed: false },
      },
      {
        id: 'hulls-incoming',
        trigger: { type: 'wave-start', wave: 5, once: true },
        speaker: 'vesk',
        lines: [
          "Heavy signatures. Those are siege hulls — they will not flinch.",
          "Stack your damage. Whittle them down before they're on the relay.",
        ],
        improvise: false,
        effects: { grantCurrency: 0, healBase: 0, pauseUntilDismissed: false },
      },
      {
        id: 'air-contact',
        trigger: { type: 'wave-start', wave: 7, once: true },
        speaker: 'scout-7',
        lines: [
          "High-band contacts. Flock-class flyers — they ignore the ground lanes.",
          "If your line can't reach the sky, the sky reaches the relay.",
        ],
        improvise: false,
        effects: { grantCurrency: 0, healBase: 0, pauseUntilDismissed: false },
      },
      {
        id: 'base-critical',
        trigger: { type: 'base-below', threshold: 40, once: true },
        speaker: 'vesk',
        lines: [
          "Relay integrity critical. We are bleeding out.",
          "Patch what you can — I'm releasing what reserves we have left.",
        ],
        improvise: false,
        effects: { grantCurrency: 75, healBase: 15, pauseUntilDismissed: false },
      },
      {
        id: 'victory',
        trigger: { type: 'run-won', once: true },
        speaker: 'vesk',
        lines: [
          "Line held. The relay's still ours.",
          "Sector stays lit because of your gunline tonight. Well fought.",
        ],
        improvise: false,
        effects: { grantCurrency: 0, healBase: 0, pauseUntilDismissed: true },
      },
      {
        id: 'defeat',
        trigger: { type: 'run-lost', once: true },
        speaker: 'scout-7',
        lines: [
          "Relay breached. Signal to the core worlds... lost.",
          "Logging final telemetry. We were close, Commander. Close is dark, all the same.",
        ],
        improvise: false,
        effects: { grantCurrency: 0, healBase: 0, pauseUntilDismissed: true },
      },
    ],
  };
}

async function main() {
  await connectDb();
  try {
    // ---- 2. Pick a target map (prefer approved, else first by creation) ----
    let map = await GameMap.findOne({ status: 'approved' }).sort({ createdAt: 1 });
    if (!map) map = await GameMap.findOne().sort({ createdAt: 1 });

    if (!map) {
      console.log(
        '[seed-campaign] No Map found in the database. The campaign needs a ' +
        'board to attach to — create/seed a Map first (e.g. node scripts/seed-demo.js), ' +
        'then re-run this script. Exiting without changes.'
      );
      return;
    }
    console.log(`[seed-campaign] Target map: "${map.slug}" (${map._id}) [status=${map.status}]`);

    // ---- 3. Upsert levels (idempotent by unique slug) ----
    const levels = buildLevels(map._id);
    const levelSlugs = [];
    for (const lvl of levels) {
      await Level.findOneAndUpdate(
        { slug: lvl.slug },
        { $set: lvl },
        { upsert: true, setDefaultsOnInsert: true, runValidators: true }
      );
      levelSlugs.push(lvl.slug);
    }
    console.log(`[seed-campaign] ✓ upserted ${levels.length} levels: ${levelSlugs.join(', ')}`);

    // ---- 4. Upsert the story arc (idempotent by unique slug) ----
    const story = buildStory(map._id, map.slug);
    await Story.findOneAndUpdate(
      { slug: story.slug },
      { $set: story },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
    const charSlugs = story.characters.map((c) => c.slug);
    console.log(
      `[seed-campaign] ✓ upserted story "${story.slug}" — ` +
      `${story.characters.length} characters (${charSlugs.join(', ')}), ` +
      `${story.beats.length} beats`
    );

    // ---- 5. Summary ----
    console.log('[seed-campaign] Summary:');
    console.log(`  map:     ${map.slug} (${map._id})`);
    console.log(`  levels:  ${levelSlugs.length} -> ${levelSlugs.join(', ')}`);
    console.log(`  story:   ${story.slug} (${story.beats.length} beats, characters: ${charSlugs.join(', ')})`);
    console.log('[seed-campaign] Done. Safe to re-run.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-campaign] Seed failed:', err);
  process.exit(1);
});
