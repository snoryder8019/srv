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
    const { characterId, destination } = req.body;

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

    const validation = validateTravel(character, destination);

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
function validateTravel(character, destination) {
  const warnings = [];
  const blockers = [];

  // Calculate distance
  const charLoc = character.location || { x: 0, y: 0, z: 0 };
  const dx = destination.x - charLoc.x;
  const dy = destination.y - charLoc.y;
  const dz = (destination.z || 0) - (charLoc.z || 0);
  const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

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

export default router;
