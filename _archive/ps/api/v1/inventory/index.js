import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { ObjectId } from 'mongodb';
import { Item } from '../models/Item.js';

const router = express.Router();

/**
 * Get character inventory (backpack + equipped)
 */
router.get('/characters/:id/inventory', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const db = getDb();
    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    // Verify ownership
    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Populate item details
    const backpackItems = await Promise.all(
      (character.backpack?.items || []).map(async (invItem) => {
        const item = await Item.findById(invItem.itemId);
        return {
          ...invItem,
          itemId: invItem.itemId.toString(), // Ensure itemId is a string for frontend
          itemDetails: item
        };
      })
    );

    // Populate equipped item details
    const equippedDetails = {};
    const equipped = character.equipped || {};

    for (const [slot, equippedItem] of Object.entries(equipped)) {
      if (equippedItem && equippedItem.itemId) {
        const item = await Item.findById(equippedItem.itemId);
        equippedDetails[slot] = {
          ...equippedItem,
          itemId: equippedItem.itemId.toString(), // Ensure itemId is a string for frontend
          itemDetails: item
        };
      } else {
        equippedDetails[slot] = null;
      }
    }

    res.json({
      characterId: character._id,
      backpack: {
        capacity: 50, // TODO: Make this dynamic based on level/upgrades
        items: backpackItems
      },
      equipped: equippedDetails
    });
  } catch (err) {
    console.error('Error fetching inventory:', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

/**
 * Add item to character backpack
 */
router.post('/characters/:id/inventory/add', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { itemId, quantity = 1 } = req.body;

    const db = getDb();
    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Verify item exists
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const backpack = character.backpack || { items: [] };

    // Check if item is stackable
    if (item.stackable) {
      // Find existing stack
      const existingStack = backpack.items.find(i => i.itemId.toString() === itemId);

      if (existingStack) {
        // Add to existing stack
        const newQuantity = existingStack.quantity + quantity;

        if (newQuantity > item.maxStack) {
          return res.status(400).json({
            error: 'Stack overflow',
            message: `Cannot add ${quantity}, max stack is ${item.maxStack}`
          });
        }

        await db.collection('characters').updateOne(
          {
            _id: new ObjectId(req.params.id),
            'backpack.items.itemId': new ObjectId(itemId)
          },
          {
            $inc: { 'backpack.items.$.quantity': quantity }
          }
        );
      } else {
        // Create new stack
        await db.collection('characters').updateOne(
          { _id: new ObjectId(req.params.id) },
          {
            $push: {
              'backpack.items': {
                itemId: new ObjectId(itemId),
                quantity,
                slot: backpack.items.length,
                metadata: {
                  condition: 100,
                  modifications: []
                }
              }
            }
          }
        );
      }
    } else {
      // Non-stackable item - add individual instances
      for (let i = 0; i < quantity; i++) {
        await db.collection('characters').updateOne(
          { _id: new ObjectId(req.params.id) },
          {
            $push: {
              'backpack.items': {
                itemId: new ObjectId(itemId),
                quantity: 1,
                slot: backpack.items.length + i,
                metadata: {
                  condition: 100,
                  modifications: []
                }
              }
            }
          }
        );
      }
    }

    res.json({
      success: true,
      message: `Added ${quantity}x ${item.name} to backpack`
    });
  } catch (err) {
    console.error('Error adding item:', err);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

/**
 * Remove item from backpack
 */
router.post('/characters/:id/inventory/remove', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { itemId, quantity = 1 } = req.body;

    const db = getDb();
    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const backpackItem = character.backpack?.items?.find(
      i => i.itemId.toString() === itemId
    );

    if (!backpackItem) {
      return res.status(404).json({ error: 'Item not in backpack' });
    }

    if (backpackItem.quantity < quantity) {
      return res.status(400).json({ error: 'Insufficient quantity' });
    }

    if (backpackItem.quantity === quantity) {
      // Remove entire stack
      await db.collection('characters').updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $pull: {
            'backpack.items': { itemId: new ObjectId(itemId) }
          }
        }
      );
    } else {
      // Reduce quantity
      await db.collection('characters').updateOne(
        {
          _id: new ObjectId(req.params.id),
          'backpack.items.itemId': new ObjectId(itemId)
        },
        {
          $inc: { 'backpack.items.$.quantity': -quantity }
        }
      );
    }

    res.json({
      success: true,
      message: `Removed ${quantity}x item from backpack`
    });
  } catch (err) {
    console.error('Error removing item:', err);
    res.status(500).json({ error: 'Failed to remove item' });
  }
});

/**
 * Equip item from backpack
 */
router.post('/characters/:id/inventory/equip', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { itemId, slot } = req.body;

    const db = getDb();
    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // Find item in backpack
    const backpackItem = character.backpack?.items?.find(
      i => i.itemId.toString() === itemId
    );

    if (!backpackItem) {
      return res.status(404).json({ error: 'Item not in backpack' });
    }

    // Verify item details
    const item = await Item.findById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Verify item type matches slot
    const validSlots = ['head', 'chest', 'legs', 'feet', 'hands', 'weapon', 'offhand', 'trinket1', 'trinket2'];
    if (!validSlots.includes(slot)) {
      return res.status(400).json({ error: 'Invalid equipment slot' });
    }

    // Check if item can be equipped in that slot
    if (item.itemType === 'equipment' && item.category !== slot && !['trinket1', 'trinket2'].includes(slot)) {
      return res.status(400).json({
        error: 'Invalid slot',
        message: `${item.name} cannot be equipped in ${slot} slot`
      });
    }

    // If slot already has an item, unequip it first
    const currentEquipped = character.equipped?.[slot];
    if (currentEquipped && currentEquipped.itemId) {
      // Add current item back to backpack
      await db.collection('characters').updateOne(
        { _id: new ObjectId(req.params.id) },
        {
          $push: {
            'backpack.items': {
              itemId: currentEquipped.itemId,
              quantity: 1,
              slot: character.backpack?.items?.length || 0,
              metadata: currentEquipped.metadata || { condition: 100, modifications: [] }
            }
          }
        }
      );
    }

    // Remove from backpack
    await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $pull: {
          'backpack.items': { itemId: new ObjectId(itemId) }
        }
      }
    );

    // Equip item
    await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          [`equipped.${slot}`]: {
            itemId: new ObjectId(itemId),
            condition: backpackItem.metadata?.condition || 100,
            metadata: backpackItem.metadata || {}
          }
        }
      }
    );

    res.json({
      success: true,
      message: `Equipped ${item.name} to ${slot}`
    });
  } catch (err) {
    console.error('Error equipping item:', err);
    res.status(500).json({ error: 'Failed to equip item' });
  }
});

/**
 * Unequip item to backpack
 */
router.post('/characters/:id/inventory/unequip', async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { slot } = req.body;

    const db = getDb();
    const character = await db.collection('characters')
      .findOne({ _id: new ObjectId(req.params.id) });

    if (!character) {
      return res.status(404).json({ error: 'Character not found' });
    }

    if (character.userId !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const equippedItem = character.equipped?.[slot];
    if (!equippedItem || !equippedItem.itemId) {
      return res.status(404).json({ error: 'No item equipped in that slot' });
    }

    // Add to backpack
    await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $push: {
          'backpack.items': {
            itemId: equippedItem.itemId,
            quantity: 1,
            slot: character.backpack?.items?.length || 0,
            metadata: equippedItem.metadata || { condition: 100, modifications: [] }
          }
        }
      }
    );

    // Clear equipment slot
    await db.collection('characters').updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          [`equipped.${slot}`]: null
        }
      }
    );

    res.json({
      success: true,
      message: `Unequipped item from ${slot}`
    });
  } catch (err) {
    console.error('Error unequipping item:', err);
    res.status(500).json({ error: 'Failed to unequip item' });
  }
});

export default router;
