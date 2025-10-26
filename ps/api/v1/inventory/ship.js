import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { Item } from '../models/Item.js';

const router = express.Router();

/**
 * Get ship cargo for a character
 * GET /api/v1/characters/:id/ship/cargo
 */
router.get('/characters/:id/ship/cargo', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');

    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Verify ownership if user authentication is present
    if (req.user && character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Initialize ship structure if it doesn't exist
    if (!character.ship) {
      character.ship = {
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
    }

    // Populate cargo item details
    const cargoItems = await Promise.all(
      (character.ship.cargoHold?.items || []).map(async (cargoItem) => {
        if (cargoItem && cargoItem.itemId) {
          const item = await Item.findById(cargoItem.itemId);
          return {
            ...cargoItem,
            itemId: cargoItem.itemId.toString(), // Ensure itemId is a string for frontend
            itemDetails: item
          };
        }
        return cargoItem;
      })
    );

    res.json({
      cargo: {
        capacity: character.ship.cargoHold?.capacity || 200,
        items: cargoItems,
        usedSpace: cargoItems.reduce((sum, item) => {
          return sum + ((item.itemDetails?.volume || 1) * (item.quantity || 1));
        }, 0)
      },
      shipInfo: {
        name: character.ship.name,
        type: character.ship.shipType
      }
    });
  } catch (err) {
    console.error('Error fetching ship cargo:', err);
    res.status(500).json({ error: 'Failed to fetch ship cargo' });
  }
});

/**
 * Transfer items between character backpack and ship cargo
 * POST /api/v1/characters/:id/ship/cargo/transfer
 * Body: { itemId, quantity, direction: 'toShip' | 'toBackpack' }
 */
router.post('/characters/:id/ship/cargo/transfer', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const { itemId, quantity, direction } = req.body;

    if (!itemId || !quantity || !direction) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['toShip', 'toBackpack'].includes(direction)) {
      return res.status(400).json({ error: 'Invalid direction' });
    }

    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Verify ownership
    if (req.user && character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get item details
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Initialize structures
    if (!character.backpack) {
      character.backpack = { capacity: 50, items: [] };
    }
    if (!character.ship) {
      character.ship = {
        name: 'Basic Hauler',
        shipType: 'hauler',
        cargoHold: { capacity: 200, items: [] },
        fittings: {
          highSlots: [null, null, null],
          midSlots: [null, null],
          lowSlots: [null, null],
          rigSlots: [null, null]
        }
      };
    }
    if (!character.ship.cargoHold) {
      character.ship.cargoHold = { capacity: 200, items: [] };
    }

    let sourceItems, destItems, sourceCapacity, destCapacity;

    if (direction === 'toShip') {
      sourceItems = character.backpack.items;
      destItems = character.ship.cargoHold.items;
      sourceCapacity = character.backpack.capacity;
      destCapacity = character.ship.cargoHold.capacity;
    } else {
      sourceItems = character.ship.cargoHold.items;
      destItems = character.backpack.items;
      sourceCapacity = character.ship.cargoHold.capacity;
      destCapacity = character.backpack.capacity;
    }

    // Find item in source
    const sourceItemIndex = sourceItems.findIndex(
      (i) => i.itemId.toString() === itemId.toString()
    );

    if (sourceItemIndex === -1) {
      return res.status(400).json({ error: 'Item not found in source inventory' });
    }

    const sourceItem = sourceItems[sourceItemIndex];

    // Check if enough quantity
    if (sourceItem.quantity < quantity) {
      return res.status(400).json({ error: 'Not enough items to transfer' });
    }

    // Check destination capacity
    const itemVolume = item.volume || 1;
    const totalVolume = itemVolume * quantity;
    const currentDestVolume = destItems.reduce((sum, i) => {
      return sum + ((i.volume || 1) * (i.quantity || 1));
    }, 0);

    if (currentDestVolume + totalVolume > destCapacity) {
      return res.status(400).json({ error: 'Not enough space in destination' });
    }

    // Perform transfer
    sourceItem.quantity -= quantity;

    // Remove from source if quantity reaches 0
    if (sourceItem.quantity <= 0) {
      sourceItems.splice(sourceItemIndex, 1);
    }

    // Add to destination
    const destItemIndex = destItems.findIndex(
      (i) => i.itemId.toString() === itemId.toString()
    );

    if (destItemIndex >= 0 && item.stackable) {
      // Stack with existing item
      destItems[destItemIndex].quantity += quantity;
    } else {
      // Add new item
      const nextSlot = destItems.length > 0
        ? Math.max(...destItems.map(i => i.slot || 0)) + 1
        : 0;

      destItems.push({
        itemId: new ObjectId(itemId),
        quantity,
        slot: nextSlot,
        metadata: {
          condition: 100
        }
      });
    }

    // Update character in database
    await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          'backpack.items': character.backpack.items,
          'ship.cargoHold.items': character.ship.cargoHold.items
        }
      }
    );

    res.json({
      success: true,
      message: `Transferred ${quantity}x ${item.name} ${direction === 'toShip' ? 'to ship' : 'to backpack'}`
    });
  } catch (err) {
    console.error('Error transferring items:', err);
    res.status(500).json({ error: 'Failed to transfer items' });
  }
});

/**
 * Get ship fittings for a character
 * GET /api/v1/characters/:id/ship/fittings
 */
router.get('/characters/:id/ship/fittings', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');

    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Verify ownership
    if (req.user && character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Initialize ship fittings if they don't exist
    if (!character.ship?.fittings) {
      return res.json({
        highSlots: [null, null, null],
        midSlots: [null, null],
        lowSlots: [null, null],
        rigSlots: [null, null]
      });
    }

    // Populate fitting item details
    const populateFittings = async (fittings) => {
      if (!Array.isArray(fittings)) return [];

      return await Promise.all(
        fittings.map(async (fitting) => {
          if (fitting && fitting.itemId) {
            const item = await Item.findById(fitting.itemId);
            return {
              ...fitting,
              itemDetails: item
            };
          }
          return null;
        })
      );
    };

    const fittings = {
      highSlots: await populateFittings(character.ship.fittings.highSlots || []),
      midSlots: await populateFittings(character.ship.fittings.midSlots || []),
      lowSlots: await populateFittings(character.ship.fittings.lowSlots || []),
      rigSlots: await populateFittings(character.ship.fittings.rigSlots || [])
    };

    res.json(fittings);
  } catch (err) {
    console.error('Error fetching ship fittings:', err);
    res.status(500).json({ error: 'Failed to fetch ship fittings' });
  }
});

/**
 * Install a module into ship fitting slot
 * POST /api/v1/characters/:id/ship/fittings/install
 * Body: { itemId, slotType: 'highSlots' | 'midSlots' | 'lowSlots' | 'rigSlots', slotIndex: number }
 */
router.post('/characters/:id/ship/fittings/install', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const { itemId, slotType, slotIndex } = req.body;

    if (!itemId || !slotType || slotIndex === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validSlotTypes = ['highSlots', 'midSlots', 'lowSlots', 'rigSlots'];
    if (!validSlotTypes.includes(slotType)) {
      return res.status(400).json({ error: 'Invalid slot type' });
    }

    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Verify ownership
    if (req.user && character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Get item details
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Verify item type is module
    if (item.itemType !== 'module') {
      return res.status(400).json({ error: 'Item is not a ship module' });
    }

    // Initialize ship fittings if they don't exist
    if (!character.ship) {
      character.ship = {
        name: 'Basic Hauler',
        shipType: 'hauler',
        cargoHold: { capacity: 200, items: [] },
        fittings: {
          highSlots: [null, null, null],
          midSlots: [null, null],
          lowSlots: [null, null],
          rigSlots: [null, null]
        }
      };
    }

    if (!character.ship.fittings) {
      character.ship.fittings = {
        highSlots: [null, null, null],
        midSlots: [null, null],
        lowSlots: [null, null],
        rigSlots: [null, null]
      };
    }

    // Check if slot index is valid
    if (slotIndex < 0 || slotIndex >= character.ship.fittings[slotType].length) {
      return res.status(400).json({ error: 'Invalid slot index' });
    }

    // Check if item is in cargo hold
    if (!character.ship.cargoHold) {
      character.ship.cargoHold = { capacity: 200, items: [] };
    }

    const cargoItemIndex = character.ship.cargoHold.items.findIndex(
      (i) => i.itemId.toString() === itemId.toString()
    );

    if (cargoItemIndex === -1) {
      return res.status(400).json({ error: 'Item not found in ship cargo. Modules must be in ship cargo to install.' });
    }

    const cargoItem = character.ship.cargoHold.items[cargoItemIndex];

    // If slot is occupied, move existing module to cargo
    if (character.ship.fittings[slotType][slotIndex]) {
      const existingModule = character.ship.fittings[slotType][slotIndex];

      // Add to cargo
      const nextSlot = character.ship.cargoHold.items.length > 0
        ? Math.max(...character.ship.cargoHold.items.map(i => i.slot || 0)) + 1
        : 0;

      character.ship.cargoHold.items.push({
        itemId: existingModule.itemId,
        quantity: 1,
        slot: nextSlot,
        metadata: existingModule.metadata || { condition: 100 }
      });
    }

    // Install new module
    character.ship.fittings[slotType][slotIndex] = {
      itemId: new ObjectId(itemId),
      metadata: cargoItem.metadata || { condition: 100 }
    };

    // Remove from cargo (reduce quantity or remove completely)
    cargoItem.quantity -= 1;
    if (cargoItem.quantity <= 0) {
      character.ship.cargoHold.items.splice(cargoItemIndex, 1);
    }

    // Update character in database
    await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          'ship.fittings': character.ship.fittings,
          'ship.cargoHold.items': character.ship.cargoHold.items
        }
      }
    );

    res.json({
      success: true,
      message: `Installed ${item.name} in ${slotType} slot ${slotIndex}`
    });
  } catch (err) {
    console.error('Error installing module:', err);
    res.status(500).json({ error: 'Failed to install module' });
  }
});

/**
 * Uninstall a module from ship fitting slot
 * POST /api/v1/characters/:id/ship/fittings/uninstall
 * Body: { slotType: 'highSlots' | 'midSlots' | 'lowSlots' | 'rigSlots', slotIndex: number }
 */
router.post('/characters/:id/ship/fittings/uninstall', async (req, res) => {
  try {
    const db = getDb();
    const { ObjectId } = await import('mongodb');
    const { slotType, slotIndex } = req.body;

    if (!slotType || slotIndex === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validSlotTypes = ['highSlots', 'midSlots', 'lowSlots', 'rigSlots'];
    if (!validSlotTypes.includes(slotType)) {
      return res.status(400).json({ error: 'Invalid slot type' });
    }

    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Verify ownership
    if (req.user && character.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!character.ship?.fittings?.[slotType]?.[slotIndex]) {
      return res.status(400).json({ error: 'No module in this slot' });
    }

    const module = character.ship.fittings[slotType][slotIndex];

    // Get item details for the response
    const item = await Item.findById(module.itemId);

    // Add module to cargo
    if (!character.ship.cargoHold) {
      character.ship.cargoHold = { capacity: 200, items: [] };
    }

    const nextSlot = character.ship.cargoHold.items.length > 0
      ? Math.max(...character.ship.cargoHold.items.map(i => i.slot || 0)) + 1
      : 0;

    character.ship.cargoHold.items.push({
      itemId: module.itemId,
      quantity: 1,
      slot: nextSlot,
      metadata: module.metadata || { condition: 100 }
    });

    // Remove from fitting slot
    character.ship.fittings[slotType][slotIndex] = null;

    // Update character in database
    await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          'ship.fittings': character.ship.fittings,
          'ship.cargoHold.items': character.ship.cargoHold.items
        }
      }
    );

    res.json({
      success: true,
      message: `Uninstalled ${item?.name || 'module'} from ${slotType} slot ${slotIndex}`
    });
  } catch (err) {
    console.error('Error uninstalling module:', err);
    res.status(500).json({ error: 'Failed to uninstall module' });
  }
});

export default router;
