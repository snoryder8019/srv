/**
 * Equip All Characters with Field Test Items
 * Gives every character the full field test loadout:
 * - Character equipment (armor, weapons, trinkets)
 * - Field Test Ship with modules
 * - Consumables in inventory
 */

import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

async function equipAllCharacters() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);

    // Get all field test assets
    const assets = await db.collection('assets').find({
      isBuiltIn: true,
      title: { $regex: /^Field Test/ }
    }).toArray();

    console.log(`Found ${assets.length} field test assets`);

    // Organize assets by type
    const assetMap = {
      ship: assets.find(a => a.assetType === 'ship'),
      modules: assets.filter(a => a.assetType === 'module'),
      armor: {
        head: assets.find(a => a.title === 'Field Test Combat Helmet'),
        chest: assets.find(a => a.title === 'Field Test Combat Suit'),
        legs: assets.find(a => a.title === 'Field Test Combat Pants'),
        feet: assets.find(a => a.title === 'Field Test Combat Boots'),
        hands: assets.find(a => a.title === 'Field Test Combat Gloves')
      },
      weapons: {
        weapon: assets.find(a => a.title === 'Field Test Plasma Rifle'),
        offhand: assets.find(a => a.title === 'Field Test Sidearm')
      },
      trinkets: {
        trinket1: assets.find(a => a.title === 'Field Test Shield Generator'),
        trinket2: assets.find(a => a.title === 'Field Test Scanner Module')
      },
      consumables: assets.filter(a => a.assetType === 'consumable')
    };

    // Get all characters
    const characters = await db.collection('characters').find({}).toArray();
    console.log(`Found ${characters.length} characters to equip`);

    let equippedCount = 0;

    for (const character of characters) {
      console.log(`\n⚙️  Equipping ${character.name}...`);

      // Build equipped object
      const equipped = {
        head: assetMap.armor.head ? {
          id: assetMap.armor.head._id.toString(),
          name: assetMap.armor.head.title
        } : null,
        chest: assetMap.armor.chest ? {
          id: assetMap.armor.chest._id.toString(),
          name: assetMap.armor.chest.title
        } : null,
        legs: assetMap.armor.legs ? {
          id: assetMap.armor.legs._id.toString(),
          name: assetMap.armor.legs.title
        } : null,
        feet: assetMap.armor.feet ? {
          id: assetMap.armor.feet._id.toString(),
          name: assetMap.armor.feet.title
        } : null,
        hands: assetMap.armor.hands ? {
          id: assetMap.armor.hands._id.toString(),
          name: assetMap.armor.hands.title
        } : null,
        weapon: assetMap.weapons.weapon ? {
          id: assetMap.weapons.weapon._id.toString(),
          name: assetMap.weapons.weapon.title
        } : null,
        offhand: assetMap.weapons.offhand ? {
          id: assetMap.weapons.offhand._id.toString(),
          name: assetMap.weapons.offhand.title
        } : null,
        trinket1: assetMap.trinkets.trinket1 ? {
          id: assetMap.trinkets.trinket1._id.toString(),
          name: assetMap.trinkets.trinket1.title
        } : null,
        trinket2: assetMap.trinkets.trinket2 ? {
          id: assetMap.trinkets.trinket2._id.toString(),
          name: assetMap.trinkets.trinket2.title
        } : null
      };

      // Build ship object with modules
      const ship = {
        name: 'Field Test Frigate',
        type: 'frigate',
        hull: {
          current: 500,
          max: 500
        },
        shield: {
          current: 300,
          max: 300
        },
        capacitor: {
          current: 200,
          max: 200,
          rechargeRate: 5
        },
        fittings: {
          highSlots: [
            assetMap.modules.find(m => m.title === 'Field Test Pulse Laser') ? {
              id: assetMap.modules.find(m => m.title === 'Field Test Pulse Laser')._id.toString(),
              name: 'Field Test Pulse Laser',
              type: 'weapon'
            } : null,
            assetMap.modules.find(m => m.title === 'Field Test Missile Launcher') ? {
              id: assetMap.modules.find(m => m.title === 'Field Test Missile Launcher')._id.toString(),
              name: 'Field Test Missile Launcher',
              type: 'weapon'
            } : null,
            null // Empty slot
          ],
          midSlots: [
            assetMap.modules.find(m => m.title === 'Field Test Shield Booster') ? {
              id: assetMap.modules.find(m => m.title === 'Field Test Shield Booster')._id.toString(),
              name: 'Field Test Shield Booster',
              type: 'defense'
            } : null,
            assetMap.modules.find(m => m.title === 'Field Test Afterburner') ? {
              id: assetMap.modules.find(m => m.title === 'Field Test Afterburner')._id.toString(),
              name: 'Field Test Afterburner',
              type: 'propulsion'
            } : null,
            null // Empty slot
          ],
          lowSlots: [
            assetMap.modules.find(m => m.title === 'Field Test Armor Plate') ? {
              id: assetMap.modules.find(m => m.title === 'Field Test Armor Plate')._id.toString(),
              name: 'Field Test Armor Plate',
              type: 'armor'
            } : null,
            assetMap.modules.find(m => m.title === 'Field Test Power Diagnostic') ? {
              id: assetMap.modules.find(m => m.title === 'Field Test Power Diagnostic')._id.toString(),
              name: 'Field Test Power Diagnostic',
              type: 'engineering'
            } : null
          ],
          rigSlots: [
            null,
            null
          ]
        },
        cargoHold: {
          capacity: 100,
          used: 0,
          items: [
            // Add consumables to cargo
            {
              id: assetMap.consumables.find(c => c.title === 'Field Test Med Kit')?._id.toString(),
              name: 'Field Test Med Kit',
              quantity: 5,
              volume: 1
            },
            {
              id: assetMap.consumables.find(c => c.title === 'Field Test Energy Cell')?._id.toString(),
              name: 'Field Test Energy Cell',
              quantity: 10,
              volume: 1
            }
          ]
        }
      };

      // Update character
      const result = await db.collection('characters').updateOne(
        { _id: character._id },
        {
          $set: {
            equipped: equipped,
            ship: ship,
            activeInShip: true,
            updatedAt: new Date()
          }
        }
      );

      if (result.modifiedCount > 0) {
        equippedCount++;
        console.log(`  ✅ Equipped ${character.name} with full field test loadout`);
        console.log(`     - Armor: 5 pieces`);
        console.log(`     - Weapons: 2 pieces`);
        console.log(`     - Trinkets: 2 pieces`);
        console.log(`     - Ship: Field Test Frigate`);
        console.log(`     - Modules: 4 fitted`);
        console.log(`     - Cargo: 5 Med Kits, 10 Energy Cells`);
      } else {
        console.log(`  ⚠️  No changes for ${character.name}`);
      }
    }

    console.log(`\n✅ Successfully equipped ${equippedCount}/${characters.length} characters!`);

    // Show summary
    console.log('\n📊 Equipment Summary:');
    console.log('Each character now has:');
    console.log('  🛡️  Character Equipment:');
    console.log('     - Field Test Combat Helmet');
    console.log('     - Field Test Combat Suit');
    console.log('     - Field Test Combat Pants');
    console.log('     - Field Test Combat Boots');
    console.log('     - Field Test Combat Gloves');
    console.log('     - Field Test Plasma Rifle');
    console.log('     - Field Test Sidearm');
    console.log('     - Field Test Shield Generator');
    console.log('     - Field Test Scanner Module');
    console.log('\n  🚀 Ship Equipment:');
    console.log('     - Field Test Frigate (500 Hull, 300 Shield)');
    console.log('     - Field Test Pulse Laser (High Slot)');
    console.log('     - Field Test Missile Launcher (High Slot)');
    console.log('     - Field Test Shield Booster (Mid Slot)');
    console.log('     - Field Test Afterburner (Mid Slot)');
    console.log('     - Field Test Armor Plate (Low Slot)');
    console.log('     - Field Test Power Diagnostic (Low Slot)');
    console.log('\n  🧪 Cargo Hold:');
    console.log('     - 5x Field Test Med Kit');
    console.log('     - 10x Field Test Energy Cell');

  } catch (error) {
    console.error('Error equipping characters:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

equipAllCharacters();
