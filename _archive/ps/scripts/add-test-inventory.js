import { connectDB, closeDB } from '../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';

/**
 * Add test inventory items to all characters
 * Gives each character:
 * - Some items in backpack
 * - Some items equipped
 * - Some items in ship cargo
 */

async function addTestInventory() {
  try {
    const db = await connectDB();

    // Get all items from database
    const items = await db.collection('items').find({}).toArray();

    if (items.length === 0) {
      console.log('❌ No items found in database. Please run seed-items.js first.');
      return;
    }

    console.log(`✅ Found ${items.length} items in database`);

    // Categorize items
    const weapons = items.filter(i => i.itemType === 'weapon');
    const consumables = items.filter(i => i.itemType === 'consumable');
    const modules = items.filter(i => i.itemType === 'module');
    const resources = items.filter(i => i.itemType === 'resource');
    const tradeGoods = items.filter(i => i.itemType === 'trade_good');
    const equipment = items.filter(i => i.itemType === 'equipment');

    console.log(`  - ${weapons.length} weapons`);
    console.log(`  - ${equipment.length} equipment`);
    console.log(`  - ${consumables.length} consumables`);
    console.log(`  - ${modules.length} modules`);
    console.log(`  - ${resources.length} resources`);
    console.log(`  - ${tradeGoods.length} trade goods`);

    // Get all characters
    const characters = await db.collection('characters').find({}).toArray();

    if (characters.length === 0) {
      console.log('❌ No characters found in database.');
      return;
    }

    console.log(`\n📦 Adding inventory to ${characters.length} characters...\n`);

    for (const character of characters) {
      console.log(`\n=== ${character.name} ===`);

      // Create backpack items
      const backpackItems = [];
      let slotCounter = 0;

      // Add some consumables
      if (consumables.length > 0) {
        const healthPack = consumables.find(i => i.name === 'Nano-Repair Kit') || consumables[0];
        backpackItems.push({
          itemId: healthPack._id,
          quantity: 5,
          slot: slotCounter++,
          metadata: { condition: 100 }
        });
        console.log(`  + Backpack: ${healthPack.name} x5`);
      }

      // Add some resources
      if (resources.length > 0) {
        for (let i = 0; i < Math.min(3, resources.length); i++) {
          backpackItems.push({
            itemId: resources[i]._id,
            quantity: Math.floor(Math.random() * 10) + 5,
            slot: slotCounter++,
            metadata: { condition: 100 }
          });
          console.log(`  + Backpack: ${resources[i].name} x${backpackItems[backpackItems.length - 1].quantity}`);
        }
      }

      // Add a trade good
      if (tradeGoods.length > 0) {
        const tradeGood = tradeGoods[0];
        backpackItems.push({
          itemId: tradeGood._id,
          quantity: 2,
          slot: slotCounter++,
          metadata: { condition: 100 }
        });
        console.log(`  + Backpack: ${tradeGood.name} x2`);
      }

      // Create equipped items
      const equippedItems = {
        head: null,
        chest: null,
        legs: null,
        feet: null,
        hands: null,
        weapon: null,
        offhand: null,
        trinket1: null,
        trinket2: null
      };

      // Equip a weapon
      if (weapons.length > 0) {
        const weapon = weapons[Math.floor(Math.random() * weapons.length)];
        equippedItems.weapon = {
          itemId: weapon._id,
          metadata: { condition: 95 }
        };
        console.log(`  + Equipped Weapon: ${weapon.name}`);
      }

      // Equip some equipment items
      if (equipment.length > 0) {
        for (const equipItem of equipment) {
          const slot = equipItem.category; // helmet, armor, boots, gloves, pants

          // Map category to equipment slot
          const slotMap = {
            'helmet': 'head',
            'armor': 'chest',
            'pants': 'legs',
            'boots': 'feet',
            'gloves': 'hands'
          };

          const targetSlot = slotMap[equipItem.category];
          if (targetSlot && equippedItems[targetSlot] === null) {
            equippedItems[targetSlot] = {
              itemId: equipItem._id,
              metadata: { condition: 90 + Math.floor(Math.random() * 10) }
            };
            console.log(`  + Equipped ${targetSlot}: ${equipItem.name}`);
          }
        }
      }

      // Create ship cargo
      const shipCargoItems = [];
      let cargoSlotCounter = 0;

      // Add some modules to ship cargo
      if (modules.length > 0) {
        for (let i = 0; i < Math.min(3, modules.length); i++) {
          shipCargoItems.push({
            itemId: modules[i]._id,
            quantity: 1,
            slot: cargoSlotCounter++,
            metadata: { condition: 100 }
          });
          console.log(`  + Ship Cargo: ${modules[i].name}`);
        }
      }

      // Add more resources to ship
      if (resources.length > 2) {
        shipCargoItems.push({
          itemId: resources[2]._id,
          quantity: 50,
          slot: cargoSlotCounter++,
          metadata: { condition: 100 }
        });
        console.log(`  + Ship Cargo: ${resources[2].name} x50`);
      }

      // Add trade goods to ship
      if (tradeGoods.length > 1) {
        shipCargoItems.push({
          itemId: tradeGoods[1]._id,
          quantity: 10,
          slot: cargoSlotCounter++,
          metadata: { condition: 100 }
        });
        console.log(`  + Ship Cargo: ${tradeGoods[1].name} x10`);
      }

      // Initialize ship structure if it doesn't exist
      const shipStructure = character.ship || {
        name: 'Basic Hauler',
        shipType: 'hauler',
        cargoHold: {
          capacity: 200,
          items: []
        },
        fittings: {
          highSlots: [null, null, null],
          midSlots: [null, null],
          lowSlots: [null, null],
          rigSlots: [null, null]
        }
      };

      // Update ship cargo
      shipStructure.cargoHold = {
        capacity: 200,
        items: shipCargoItems
      };

      // Update character in database
      await db.collection('characters').updateOne(
        { _id: character._id },
        {
          $set: {
            backpack: {
              capacity: 50,
              items: backpackItems
            },
            equipped: equippedItems,
            ship: shipStructure
          }
        }
      );

      console.log(`✅ Updated ${character.name} with test inventory`);
    }

    console.log('\n✅ All characters updated with test inventory!');
    console.log('\nSummary:');
    console.log(`  - ${characters.length} characters updated`);
    console.log('  - Each has backpack items (consumables, resources, trade goods)');
    console.log('  - Each has equipped items (weapon, armor pieces)');
    console.log('  - Each has ship cargo (modules, resources, trade goods)');

  } catch (error) {
    console.error('❌ Error adding test inventory:', error);
    process.exit(1);
  }
}

// Run the script
addTestInventory()
  .then(async () => {
    await closeDB();
    console.log('\n✅ Script complete!');
    process.exit(0);
  })
  .catch(async (error) => {
    await closeDB();
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
