/**
 * Storehouse API
 * Galaxy-level inventory management
 */
import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

/**
 * GET /api/v1/storehouse/:galaxyId
 * Get storehouse inventory for a galaxy
 */
router.get('/:galaxyId', async (req, res) => {
  try {
    const { galaxyId } = req.params;

    if (!galaxyId) {
      return res.json({ success: false, error: 'Missing galaxyId' });
    }

    const db = getDb();

    // Find storehouse
    let storehouse = await db.collection(collections.storehouses).findOne({
      galaxyId: new ObjectId(galaxyId)
    });

    // Create if doesn't exist
    if (!storehouse) {
      const newStorehouse = {
        galaxyId: new ObjectId(galaxyId),
        inventory: {
          fuel: 50000,
          food: 20000,
          oxygen: 100000,
          medkits: 5000,
          custom: []
        },
        access: {
          public: true,
          allowedUsers: []
        },
        lastUpdated: new Date(),
        createdAt: new Date()
      };

      const result = await db.collection(collections.storehouses).insertOne(newStorehouse);
      storehouse = { ...newStorehouse, _id: result.insertedId };
      console.log(`✅ Created storehouse for galaxy ${galaxyId}`);
    }

    // Get galaxy name
    const galaxy = await db.collection(collections.assets).findOne({
      _id: new ObjectId(galaxyId)
    });

    res.json({
      success: true,
      storehouse: storehouse,
      galaxyName: galaxy?.title || 'Unknown Galaxy'
    });

  } catch (error) {
    console.error('❌ Storehouse fetch error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/storehouse/:galaxyId/transfer
 * Transfer items from storehouse to character ship
 */
router.post('/:galaxyId/transfer', async (req, res) => {
  try {
    const { galaxyId } = req.params;
    const { characterId, item, amount } = req.body;

    if (!galaxyId || !characterId || !item || !amount) {
      return res.json({
        success: false,
        error: 'Missing required fields'
      });
    }

    const db = getDb();

    // Get storehouse
    const storehouse = await db.collection(collections.storehouses).findOne({
      galaxyId: new ObjectId(galaxyId)
    });

    if (!storehouse) {
      return res.json({ success: false, error: 'Storehouse not found' });
    }

    // Check if enough in storehouse
    if (storehouse.inventory[item] < amount) {
      return res.json({
        success: false,
        error: `Insufficient ${item} in storehouse`,
        available: storehouse.inventory[item]
      });
    }

    // Get character
    const character = await db.collection(collections.characters).findOne({
      _id: new ObjectId(characterId)
    });

    if (!character) {
      return res.json({ success: false, error: 'Character not found' });
    }

    // Reduce storehouse inventory
    const newStorehouseAmount = storehouse.inventory[item] - amount;
    await db.collection(collections.storehouses).updateOne(
      { _id: storehouse._id },
      {
        $set: {
          [`inventory.${item}`]: newStorehouseAmount,
          lastUpdated: new Date()
        }
      }
    );

    // Add to character ship
    let updateField = '';
    let currentAmount = 0;

    switch(item) {
      case 'fuel':
        updateField = 'ship.fittings.fuelTanks.remaining';
        currentAmount = character.ship?.fittings?.fuelTanks?.remaining || 0;
        break;
      case 'food':
        updateField = 'ship.fittings.lifeSupport.foodRemaining';
        currentAmount = character.ship?.fittings?.lifeSupport?.foodRemaining || 0;
        break;
      case 'oxygen':
        updateField = 'ship.fittings.lifeSupport.oxygenRemaining';
        currentAmount = character.ship?.fittings?.lifeSupport?.oxygenRemaining || 0;
        break;
      case 'medkits':
        updateField = 'ship.fittings.medicalBay.medKitsRemaining';
        currentAmount = character.ship?.fittings?.medicalBay?.medKitsRemaining || 0;
        break;
      default:
        return res.json({ success: false, error: `Unknown item type: ${item}` });
    }

    const newCharAmount = currentAmount + amount;
    await db.collection(collections.characters).updateOne(
      { _id: character._id },
      { $set: { [updateField]: newCharAmount } }
    );

    console.log(`✅ Transferred ${amount} ${item} from storehouse to ${character.name}`);

    res.json({
      success: true,
      item: item,
      amount: amount,
      storehouseRemaining: newStorehouseAmount,
      characterNew: newCharAmount
    });

  } catch (error) {
    console.error('❌ Transfer error:', error);
    res.json({ success: false, error: error.message });
  }
});

export default router;
