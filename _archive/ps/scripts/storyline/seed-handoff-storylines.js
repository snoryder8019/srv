/**
 * Seed Storyline Assets from Handoff Data
 * Imports storyline arcs, NPCs, locations, quests, and scripts from first_handoff.md
 */

import { config } from 'dotenv';
config();

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_URL = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME || 'projectStringborne';

// Parse the handoff JSON data from first_handoff.md
const handoffPath = join(__dirname, '../../docs/storylines/handoffs/first_handoff.md');
const handoffContent = readFileSync(handoffPath, 'utf-8');

// Extract JSON blocks from the markdown file
const jsonBlocks = [];
const jsonMatches = handoffContent.matchAll(/\{[\s\S]*?\n\}/g);
for (const match of jsonMatches) {
  try {
    const parsed = JSON.parse(match[0]);
    jsonBlocks.push(parsed);
  } catch (e) {
    console.log('Skipping invalid JSON block');
  }
}

console.log(`Found ${jsonBlocks.length} JSON blocks in handoff file`);

async function main() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    const db = client.db(DB_NAME);
    const assetsCollection = db.collection('assets');

    // Get existing galaxies for linking
    const galaxies = await assetsCollection.find({ assetType: 'galaxy' }).toArray();
    console.log(`\nFound ${galaxies.length} existing galaxies in database`);

    // Find Void's Edge galaxy for linking
    const voidsEdge = galaxies.find(g => g.title === "Void's Edge");
    const luminaPrime = galaxies.find(g => g.title === "Lumina Prime");

    // Track created assets for linking
    const createdArcs = {};
    const createdNPCs = {};
    const createdLocations = {};
    const createdQuests = {};

    // Process each JSON block
    for (const [index, block] of jsonBlocks.entries()) {
      console.log(`\n=== Processing JSON Block ${index + 1} ===`);

      // ===== PROCESS NARRATIVE ARCS =====
      if (block.narrative_arcs) {
        console.log(`\n📖 Processing ${block.narrative_arcs.length} Narrative Arcs...`);

        for (const arc of block.narrative_arcs) {
          const arcAsset = {
            userId: new ObjectId('000000000000000000000001'), // System user
            title: arc.title,
            description: arc.core_conflict,
            assetType: 'storyline_arc',
            subType: arc.id,

            // Arc-specific fields
            arc_setting: arc.setting,
            arc_themes: arc.themes || [],
            arc_conflict: arc.core_conflict,
            arc_visual_mood: arc.visual_mood,
            arc_quest_hooks: arc.quest_hooks || [],
            arc_linked_assets: [],

            // Lore
            lore: `Setting: ${arc.setting}\n\nThemes: ${arc.themes.join(', ')}\n\nVisual Mood: ${arc.visual_mood}`,
            backstory: null,
            flavor: arc.visual_mood,

            // Link to galaxies based on arc title
            parentGalaxy: arc.title.includes('Lost in Space') ? voidsEdge?._id :
                          arc.title.includes('Deepcore') ? luminaPrime?._id : null,

            coordinates: { x: 0, y: 0, z: 0 },
            stats: {},
            tags: arc.themes || [],
            category: 'storyline',
            status: 'approved',

            // Community
            votes: 0,
            voters: [],
            suggestions: [],
            collaborators: [],

            createdAt: new Date(),
            updatedAt: new Date(),
            approvedAt: new Date(),
            approvedBy: new ObjectId('000000000000000000000001')
          };

          const result = await assetsCollection.insertOne(arcAsset);
          createdArcs[arc.id] = result.insertedId;
          console.log(`  ✅ Created arc: ${arc.title} (${arc.id})`);
        }
      }

      // ===== PROCESS STORY LOCATIONS =====
      if (block.story_environments) {
        console.log(`\n📍 Processing ${block.story_environments.length} Story Locations...`);

        for (const loc of block.story_environments) {
          const linkedArcId = createdArcs[loc.arc.toLowerCase().replace(/ /g, '_').replace('arc', 'arc')];

          const locationAsset = {
            userId: new ObjectId('000000000000000000000001'),
            title: loc.name,
            description: `${loc.arc} location: ${loc.mood_tags.join(', ')}`,
            assetType: 'storyline_location',
            subType: loc.location_id,

            location_arc_id: linkedArcId?.toString() || null,
            location_mood_tags: loc.mood_tags || [],
            location_interactive_elements: loc.interactive_elements || [],
            location_linked_asset: loc.arc.includes('Lost in Space') ? voidsEdge?._id.toString() :
                                    loc.arc.includes('Mogul') ? luminaPrime?._id.toString() : null,
            location_zone_name: loc.location_id,

            lore: `Part of ${loc.arc}\n\nMood: ${loc.mood_tags.join(', ')}\n\nInteractive: ${loc.interactive_elements.join(', ')}`,

            parentGalaxy: loc.arc.includes('Lost in Space') ? voidsEdge?._id : luminaPrime?._id,
            coordinates: { x: 0, y: 0, z: 0 },
            stats: {},
            tags: loc.mood_tags || [],
            category: 'storyline',
            status: 'approved',

            votes: 0,
            voters: [],
            suggestions: [],
            collaborators: [],

            createdAt: new Date(),
            updatedAt: new Date(),
            approvedAt: new Date(),
            approvedBy: new ObjectId('000000000000000000000001')
          };

          const result = await assetsCollection.insertOne(locationAsset);
          createdLocations[loc.location_id] = result.insertedId;
          console.log(`  ✅ Created location: ${loc.name} (${loc.location_id})`);
        }
      }

      // ===== PROCESS CHARACTERS/NPCs =====
      if (block.characters) {
        console.log(`\n🎭 Processing ${block.characters.length} NPCs...`);

        for (const char of block.characters) {
          // Handle both formats: char.arc (first handoff) and block.arc_id (second handoff)
          const arcName = char.arc || block.title || '';
          const linkedArcId = createdArcs[block.arc_id] || createdArcs[arcName.toLowerCase().replace(/ /g, '_').replace('arc', 'arc')];

          const npcAsset = {
            userId: new ObjectId('000000000000000000000001'),
            title: char.name,
            description: `${char.role}${arcName ? ' in ' + arcName : ''}`,
            assetType: 'storyline_npc',
            subType: char.character_id || `npc_${char.name.toLowerCase().replace(/ /g, '_')}`,

            npc_role: char.role.toLowerCase().replace(/ /g, '_'),
            npc_arc_id: linkedArcId?.toString() || block.arc_id || null,
            npc_traits: char.traits || [],
            npc_dialogue_style: char.dialogue_style || 'Standard',
            npc_locations: [],
            npc_signature_items: char.signature_items || char.visuals || [],

            lore: `${char.role}${arcName ? ' in ' + arcName : ''}\n\nTraits: ${(char.traits || []).join(', ')}\n\nDialogue: ${char.dialogue_style || 'Standard'}`,
            backstory: (char.traits || []).join(', '),
            flavor: char.dialogue_style || '',

            parentGalaxy: (arcName.includes('Lost in Space') || arcName.includes('Faith-Time')) ? voidsEdge?._id : luminaPrime?._id,
            coordinates: { x: 0, y: 0, z: 0 },
            stats: {},
            tags: char.traits || [],
            category: 'storyline',
            status: 'approved',

            votes: 0,
            voters: [],
            suggestions: [],
            collaborators: [],

            createdAt: new Date(),
            updatedAt: new Date(),
            approvedAt: new Date(),
            approvedBy: new ObjectId('000000000000000000000001')
          };

          const result = await assetsCollection.insertOne(npcAsset);
          createdNPCs[char.character_id] = result.insertedId;
          console.log(`  ✅ Created NPC: ${char.name} (${char.character_id})`);
        }
      }

      // ===== PROCESS QUEST TRIGGERS =====
      if (block.quest_triggers) {
        console.log(`\n📜 Processing ${block.quest_triggers.length} Quests...`);

        for (const trigger of block.quest_triggers) {
          const linkedArcId = createdArcs[trigger.arc.toLowerCase().replace(/ /g, '_').replace('arc', 'arc')];

          const questAsset = {
            userId: new ObjectId('000000000000000000000001'),
            title: trigger.result,
            description: trigger.condition,
            assetType: 'storyline_quest',
            subType: trigger.trigger_id,

            quest_arc_id: linkedArcId?.toString() || null,
            quest_type: 'main',
            quest_trigger_condition: trigger.condition,
            quest_objectives: [trigger.result],
            quest_rewards: [],
            quest_prerequisites: [],

            lore: `Part of ${trigger.arc}\n\nTrigger: ${trigger.condition}\n\nResult: ${trigger.result}`,

            parentGalaxy: trigger.arc.includes('Lost in Space') ? voidsEdge?._id : luminaPrime?._id,
            coordinates: { x: 0, y: 0, z: 0 },
            stats: {},
            tags: ['quest', 'trigger'],
            category: 'storyline',
            status: 'approved',

            votes: 0,
            voters: [],
            suggestions: [],
            collaborators: [],

            createdAt: new Date(),
            updatedAt: new Date(),
            approvedAt: new Date(),
            approvedBy: new ObjectId('000000000000000000000001')
          };

          const result = await assetsCollection.insertOne(questAsset);
          createdQuests[trigger.trigger_id] = result.insertedId;
          console.log(`  ✅ Created quest: ${trigger.result} (${trigger.trigger_id})`);
        }
      }

      // ===== PROCESS SCRIPTS (from arc_04 Faith-Time vs Space-Time) =====
      if (block.script_copy) {
        console.log(`\n🎬 Processing ${block.script_copy.length} Cinematic Scripts...`);

        for (const scene of block.script_copy) {
          const linkedArcId = createdArcs['arc_04'];

          const scriptAsset = {
            userId: new ObjectId('000000000000000000000001'),
            title: scene.scene,
            description: scene.description,
            assetType: 'storyline_script',
            subType: `script_${scene.scene.toLowerCase().replace(/ /g, '_')}`,

            script_arc_id: linkedArcId?.toString() || 'arc_04',
            script_scene_title: scene.scene,
            script_location_id: scene.location,
            script_scene_description: scene.description,
            script_dialogue: Array.isArray(scene.dialogue) ? scene.dialogue.join('\n') : JSON.stringify(scene.dialogue),
            script_actions: scene.actions || [],
            script_cinematic_trigger: scene.transition || null,

            lore: `Scene: ${scene.scene}\n\nLocation: ${scene.location}\n\n${scene.description}`,
            backstory: scene.location,
            flavor: scene.description,

            parentGalaxy: voidsEdge?._id,
            coordinates: { x: 0, y: 0, z: 0 },
            stats: {},
            tags: ['script', 'cinematic', 'dialogue'],
            category: 'storyline',
            status: 'approved',

            votes: 0,
            voters: [],
            suggestions: [],
            collaborators: [],

            createdAt: new Date(),
            updatedAt: new Date(),
            approvedAt: new Date(),
            approvedBy: new ObjectId('000000000000000000000001')
          };

          const result = await assetsCollection.insertOne(scriptAsset);
          console.log(`  ✅ Created script: ${scene.scene}`);
        }
      }
    }

    // Summary
    console.log('\n=== SEEDING COMPLETE ===');
    console.log(`📖 Arcs: ${Object.keys(createdArcs).length}`);
    console.log(`🎭 NPCs: ${Object.keys(createdNPCs).length}`);
    console.log(`📍 Locations: ${Object.keys(createdLocations).length}`);
    console.log(`📜 Quests: ${Object.keys(createdQuests).length}`);
    console.log(`\n✅ Storyline assets seeded successfully!`);

  } catch (error) {
    console.error('❌ Error seeding storylines:', error);
    throw error;
  } finally {
    await client.close();
    console.log('\n🔌 MongoDB connection closed');
  }
}

main().catch(console.error);
