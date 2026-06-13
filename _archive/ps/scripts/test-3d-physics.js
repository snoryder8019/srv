import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import { Character } from '../api/v1/models/Character.js';
import { Asset } from '../api/v1/models/Asset.js';
import { Vector3D } from '../api/v1/physics/physics3d.js';

async function test3DPhysics() {
  console.log('🧪 Testing 3D Physics System...\n');

  await connectDB();
  const db = getDb();

  // Get a test character
  const characters = await Character.getGalacticCharacters();
  if (characters.length === 0) {
    console.log('❌ No characters found. Create a character first.');
    process.exit(1);
  }

  const testChar = characters[0];
  console.log('📍 Test Character: ' + testChar.name);
  console.log('   Current Position: (' + 
    testChar.location.x.toFixed(2) + ', ' + 
    testChar.location.y.toFixed(2) + ', ' + 
    (testChar.location.z || 0).toFixed(2) + ')');
  console.log('   Current Velocity: (' + 
    (testChar.location.vx || 0).toFixed(2) + ', ' + 
    (testChar.location.vy || 0).toFixed(2) + ', ' + 
    (testChar.location.vz || 0).toFixed(2) + ')\n');

  // Test 1: Apply Thrust
  console.log('🚀 Test 1: Apply Thrust');
  console.log('   Direction: (1, 0, 0.5) - Forward and up');
  
  const newVel = await Character.applyThrust(
    testChar._id.toString(),
    { x: 1, y: 0, z: 0.5 },
    1.0
  );
  
  console.log('   New Velocity: (' + 
    newVel.vx.toFixed(2) + ', ' + 
    newVel.vy.toFixed(2) + ', ' + 
    newVel.vz.toFixed(2) + ')\n');

  // Test 2: Get Nearby Celestial Bodies
  console.log('🌍 Test 2: Nearby Celestial Bodies');
  const bodies = await Asset.getByTypes(['star', 'planet', 'orbital']);
  console.log('   Found ' + bodies.length + ' celestial bodies');
  
  const nearbyBodies = bodies.filter(body => {
    const dx = body.coordinates.x - testChar.location.x;
    const dy = body.coordinates.y - testChar.location.y;
    const dz = (body.coordinates.z || 0) - (testChar.location.z || 0);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return dist < 200;
  });
  
  console.log('   Nearby (< 200 units): ' + nearbyBodies.length);
  nearbyBodies.slice(0, 3).forEach(body => {
    const dx = body.coordinates.x - testChar.location.x;
    const dy = body.coordinates.y - testChar.location.y;
    const dz = (body.coordinates.z || 0) - (testChar.location.z || 0);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    console.log('     - ' + body.title + ' (' + body.assetType + ') at ' + dist.toFixed(1) + ' units');
  });
  console.log('');

  // Test 3: Set Orbit Around a Planet
  if (nearbyBodies.length > 0) {
    const targetBody = nearbyBodies[0];
    console.log('🛸 Test 3: Set Orbit Around ' + targetBody.title);
    console.log('   Orbit radius: 50 units');
    
    const centralBody = {
      position: {
        x: targetBody.coordinates.x,
        y: targetBody.coordinates.y,
        z: targetBody.coordinates.z || 0
      },
      mass: targetBody.stats && targetBody.stats.mass ? targetBody.stats.mass : 1000
    };
    
    const orbit = await Character.setOrbit(
      testChar._id.toString(),
      centralBody,
      50,
      0
    );
    
    console.log('   New Position: (' + 
      orbit.position.x.toFixed(2) + ', ' + 
      orbit.position.y.toFixed(2) + ', ' + 
      orbit.position.z.toFixed(2) + ')');
    console.log('   Orbital Velocity: (' + 
      orbit.velocity.x.toFixed(2) + ', ' + 
      orbit.velocity.y.toFixed(2) + ', ' + 
      orbit.velocity.z.toFixed(2) + ')\n');
  }

  // Test 4: Check Character State
  const updatedChar = await Character.findById(testChar._id);
  console.log('📊 Final State:');
  console.log('   Position: (' + 
    updatedChar.location.x.toFixed(2) + ', ' + 
    updatedChar.location.y.toFixed(2) + ', ' + 
    updatedChar.location.z.toFixed(2) + ')');
  console.log('   Velocity: (' + 
    updatedChar.location.vx.toFixed(2) + ', ' + 
    updatedChar.location.vy.toFixed(2) + ', ' + 
    updatedChar.location.vz.toFixed(2) + ')');
  console.log('   Speed: ' + Math.sqrt(
    updatedChar.location.vx * updatedChar.location.vx +
    updatedChar.location.vy * updatedChar.location.vy +
    updatedChar.location.vz * updatedChar.location.vz
  ).toFixed(2) + ' units/sec\n');

  console.log('✅ 3D Physics Tests Complete!\n');
  process.exit(0);
}

test3DPhysics();
