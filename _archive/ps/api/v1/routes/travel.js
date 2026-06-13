/**
 * Travel Validation API
 * Validates if character has sufficient supplies to travel to destination
 */
import express from 'express';
import { getDb } from '../../../plugins/mongo/mongo.js';
import { collections } from '../../../config/database.js';
import { ObjectId } from 'mongodb';

const router = express.Router();

/**
 * POST /api/v1/travel/validate
 * Validate if character can travel to destination
 */
router.post('/validate', async (req, res) => {
  try {
    const { characterId, destination, destinationAssetId, travelType } = req.body;

    if (!characterId || !destination) {
      return res.json({
        success: false,
        error: 'Missing characterId or destination'
      });
    }

    const db = getDb();
    const character = await db.collection(collections.characters).findOne({
      _id: new ObjectId(characterId)
    });

    if (!character) {
      return res.json({ success: false, error: 'Character not found' });
    }

    // Get destination asset if ID provided
    let destinationAsset = null;
    if (destinationAssetId) {
      destinationAsset = await db.collection(collections.assets).findOne({
        _id: new ObjectId(destinationAssetId)
      });
    }

    // Get character's current asset (if docked)
    let currentAsset = null;
    if (character.location?.dockedGalaxyId || character.location?.assetId) {
      const currentAssetId = character.location.dockedGalaxyId || character.location.assetId;
      currentAsset = await db.collection(collections.assets).findOne({
        _id: new ObjectId(currentAssetId)
      });
    }

    const validation = validateTravel(character, destination, destinationAsset, currentAsset, travelType);

    res.json({
      success: true,
      ...validation
    });

  } catch (error) {
    console.error('❌ Travel validation error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * Validate travel requirements
 */
function validateTravel(character, destination, destinationAsset, currentAsset, travelType) {
  const warnings = [];
  const blockers = [];

  // Calculate distance
  const charLoc = character.location || { x: 0, y: 0, z: 0 };
  const dx = destination.x - charLoc.x;
  const dy = destination.y - charLoc.y;
  const dz = (destination.z || 0) - (charLoc.z || 0);
  const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

  // RULE 1: Fall into galaxy (no fuel needed, just proximity + food + medkits)
  if (travelType === 'fall' && destinationAsset?.assetType === 'galaxy') {
    // Check if close enough to fall in (within 500 units)
    if (distance > 500) {
      blockers.push({
        type: 'distance',
        message: `Too far to fall into galaxy! Must be within 500 units, you are ${Math.round(distance)} units away.`,
        required: 500,
        current: Math.round(distance)
      });
    }

    // Check food and medkits for falling
    const currentFood = character.ship?.fittings?.lifeSupport?.foodRemaining || 0;
    const currentMedkits = character.ship?.fittings?.medicalBay?.medKitsRemaining || 0;

    if (currentFood < 10) {
      blockers.push({
        type: 'food',
        message: `Insufficient food to survive fall! Need at least 10, have ${currentFood}`,
        required: 10,
        current: currentFood
      });
    }

    if (currentMedkits < 1) {
      blockers.push({
        type: 'medkits',
        message: `Insufficient medkits to survive fall! Need at least 1, have ${currentMedkits}`,
        required: 1,
        current: currentMedkits
      });
    }

    return {
      canTravel: blockers.length === 0,
      travelType: 'fall',
      requirements: { food: 10, medkits: 1, distance: 500 },
      currentSupplies: {
        food: currentFood,
        medkits: currentMedkits,
        distance: Math.round(distance)
      },
      blockers,
      warnings
    };
  }

  // RULE 2: Travel along connection (requires fuel + connection exists)
  // Check if there's a connection between current and destination asset
  if (currentAsset && destinationAsset) {
    // For connection travel, must have active connection
    // This will be checked client-side against physics service connections
    // For now, we add a note
    warnings.push({
      type: 'connection',
      message: 'Verify connection exists on galactic map before traveling',
      severity: 'high'
    });
  }

  // Calculate travel time
  const shipSpeed = character.ship?.stats?.maxSpeed || 10;
  const travelTimeSeconds = distance / shipSpeed;
  const travelTimeHours = travelTimeSeconds / 3600;

  // Calculate requirements
  const requirements = {
    fuel: Math.ceil(distance * 0.5),
    food: Math.ceil(travelTimeHours * 2),
    oxygen: Math.ceil(travelTimeHours * 5),
    medkits: distance > 5000 ? 2 : 0,
    travelTime: travelTimeSeconds,
    distance: distance
  };

  // Get current supplies
  const currentFuel = character.ship?.fittings?.fuelTanks?.remaining || 0;
  const currentFood = character.ship?.fittings?.lifeSupport?.foodRemaining || 0;
  const currentOxygen = character.ship?.fittings?.lifeSupport?.oxygenRemaining || 0;
  const currentMedkits = character.ship?.fittings?.medicalBay?.medKitsRemaining || 0;

  // Check fuel
  if (currentFuel < requirements.fuel) {
    blockers.push({
      type: 'fuel',
      message: `Insufficient fuel! Need ${requirements.fuel}, have ${currentFuel}`,
      required: requirements.fuel,
      current: currentFuel
    });
  } else if (currentFuel < requirements.fuel * 1.5) {
    warnings.push({
      type: 'fuel',
      message: 'Low fuel reserves. Consider refueling.',
      severity: 'medium'
    });
  }

  // Check food
  if (currentFood < requirements.food) {
    blockers.push({
      type: 'food',
      message: `Insufficient food! Need ${requirements.food}, have ${currentFood}`,
      required: requirements.food,
      current: currentFood
    });
  } else if (currentFood < requirements.food * 1.5) {
    warnings.push({
      type: 'food',
      message: 'Low food supplies. Stock up before long journey.',
      severity: 'medium'
    });
  }

  // Check oxygen
  if (currentOxygen < requirements.oxygen) {
    blockers.push({
      type: 'oxygen',
      message: `Insufficient oxygen! Need ${requirements.oxygen}, have ${currentOxygen}`,
      required: requirements.oxygen,
      current: currentOxygen
    });
  } else if (currentOxygen < requirements.oxygen * 1.5) {
    warnings.push({
      type: 'oxygen',
      message: 'Low oxygen reserves. Refill life support.',
      severity: 'medium'
    });
  }

  // Check medkits for long journeys
  if (requirements.medkits > 0 && currentMedkits < requirements.medkits) {
    warnings.push({
      type: 'medkits',
      message: `Long journey recommended medkits: ${requirements.medkits}, you have ${currentMedkits}`,
      severity: 'low'
    });
  }

  // Estimate arrival condition
  let health = 100;
  let shipCondition = 100;
  let survivalChance = 100;

  warnings.forEach(warning => {
    if (warning.type === 'fuel') survivalChance -= 10;
    if (warning.type === 'food') survivalChance -= 5;
    if (warning.type === 'oxygen') survivalChance -= 5;
  });

  blockers.forEach(blocker => {
    survivalChance -= 30;
  });

  survivalChance = Math.max(0, Math.min(100, survivalChance));

  return {
    canTravel: blockers.length === 0,
    warnings: warnings,
    blockers: blockers,
    requirements: requirements,
    currentSupplies: {
      fuel: currentFuel,
      food: currentFood,
      oxygen: currentOxygen,
      medkits: currentMedkits
    },
    estimatedArrivalCondition: {
      health: health,
      shipCondition: shipCondition,
      survivalChance: survivalChance
    }
  };
}

/**
 * POST /api/v1/characters/deduct-fuel
 * Deduct fuel from character's ship
 */
router.post('/deduct-fuel', async (req, res) => {
  try {
    const { characterId, fuelAmount } = req.body;

    if (!characterId || !fuelAmount) {
      return res.json({
        success: false,
        error: 'Missing characterId or fuelAmount'
      });
    }

    const db = getDb();
    const character = await db.collection(collections.characters).findOne({
      _id: new ObjectId(characterId)
    });

    if (!character) {
      return res.json({ success: false, error: 'Character not found' });
    }

    const currentFuel = character.ship?.fittings?.fuelTanks?.remaining || 0;

    if (currentFuel < fuelAmount) {
      return res.json({
        success: false,
        error: `Insufficient fuel! Have ${currentFuel}, need ${fuelAmount}`
      });
    }

    // Deduct fuel
    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      {
        $inc: {
          'ship.fittings.fuelTanks.remaining': -fuelAmount
        }
      }
    );

    res.json({
      success: true,
      fuelDeducted: fuelAmount,
      remainingFuel: currentFuel - fuelAmount
    });

  } catch (error) {
    console.error('❌ Fuel deduction error:', error);
    res.json({ success: false, error: error.message });
  }
});

/**
 * POST /api/v1/travel/travel-status
 * Update character travel status (in-transit or docked)
 */
router.post('/travel-status', async (req, res) => {
  try {
    const { characterId, isInTransit, from, to, estimatedArrival } = req.body;

    if (!characterId) {
      return res.json({ success: false, error: 'Missing characterId' });
    }

    const db = getDb();

    // Build update object
    const updateData = {
      'navigation.isInTransit': isInTransit
    };

    if (isInTransit) {
      // Set travel data
      updateData['navigation.from'] = from;
      updateData['navigation.to'] = to;
      updateData['navigation.estimatedArrival'] = estimatedArrival;
      updateData['navigation.startTime'] = Date.now();
    } else {
      // Clear travel data when not in transit
      updateData['navigation.from'] = null;
      updateData['navigation.to'] = null;
      updateData['navigation.estimatedArrival'] = null;
      updateData['navigation.startTime'] = null;
    }

    const result = await db.collection(collections.characters).updateOne(
      { _id: new ObjectId(characterId) },
      { $set: updateData }
    );

    if (result.modifiedCount > 0) {
      console.log(`✅ Character ${characterId} travel status updated: isInTransit=${isInTransit}`);
      res.json({
        success: true,
        isInTransit,
        message: isInTransit ? 'Travel status set to in-transit' : 'Travel status set to docked'
      });
    } else {
      res.json({ success: false, error: 'No changes made' });
    }

  } catch (error) {
    console.error('❌ Travel status update error:', error);
    res.json({ success: false, error: error.message });
  }
});

export default router;
