/**
 * Check Starship Colony Setup
 * Shows what assets you have and what you need next
 */

import { getDb, connectDB } from '../plugins/mongo/mongo.js';

async function checkSetup() {
  try {
    await connectDB();
    const db = getDb();

    console.log('🚀 STARSHIP COLONY SETUP CHECK\n');
    console.log('═'.repeat(60));

    // 1. Check Anomalies (Starship Colonies)
    const anomalies = await db.collection('assets').find({ assetType: 'anomaly' }).toArray();
    console.log('\n📍 STEP 1: ANOMALIES (Starship Colonies)');
    console.log('─'.repeat(60));
    if (anomalies.length === 0) {
      console.log('❌ No anomalies found!');
      console.log('   → Create one at: /assets/builder-enhanced');
    } else {
      console.log(`✅ Found ${anomalies.length} anomalies:\n`);
      for (const anomaly of anomalies) {
        console.log(`   🌀 ${anomaly.title || anomaly.name}`);
        console.log(`      ID: ${anomaly._id}`);
        console.log(`      Coordinates: (${anomaly.coordinates?.x || 0}, ${anomaly.coordinates?.y || 0}, ${anomaly.coordinates?.z || 0})`);
        console.log(`      Has 3D Model: ${anomaly.models?.gltf ? 'Yes ✅' : 'No (shows as orb)'}`);

        // Check if it has interior zones
        const zones = await db.collection('assets').find({
          assetType: 'zone',
          'hierarchy.parent': anomaly._id
        }).toArray();

        console.log(`      Interior Zones: ${zones.length}`);
        if (zones.length > 0) {
          zones.forEach(z => console.log(`         └─ ${z.title || z.name}`));
        } else {
          console.log(`         └─ ⚠️  No interior yet! Create at: /universe/interior-map-builder?parentAssetId=${anomaly._id}&parentAssetType=anomaly`);
        }
        console.log('');
      }
    }

    // 2. Check Zones (Floormaps/Interiors)
    console.log('\n🗺️  STEP 2: ZONES (Interior Floormaps)');
    console.log('─'.repeat(60));
    const allZones = await db.collection('assets').find({ assetType: 'zone' }).toArray();
    if (allZones.length === 0) {
      console.log('❌ No zones found!');
      console.log('   → Create at: /universe/interior-map-builder');
    } else {
      console.log(`✅ Found ${allZones.length} zones:\n`);
      for (const zone of allZones) {
        console.log(`   🏛️  ${zone.title || zone.name}`);
        console.log(`      ID: ${zone._id}`);
        console.log(`      Parent: ${zone.hierarchy?.parent ? zone.hierarchy.parent : 'None (standalone)'}`);
        console.log(`      Size: ${zone.zoneData?.width || '?'} x ${zone.zoneData?.height || '?'}`);

        // Check sprites
        const sprites = await db.collection('assets').find({
          assetType: 'sprite',
          'hierarchy.parent': zone._id
        }).toArray();

        console.log(`      Linked Sprites: ${sprites.length}`);
        if (sprites.length > 0) {
          console.log(`         ✅ Has visual tiles!`);
        } else {
          console.log(`         ⚠️  No sprites yet! Import at: /assets/sprite-creator?zoneId=${zone._id}`);
        }
        console.log('');
      }
    }

    // 3. Check Sprites
    console.log('\n🎨 STEP 3: SPRITES (Visual Tiles)');
    console.log('─'.repeat(60));
    const allSprites = await db.collection('assets').find({ assetType: 'sprite' }).toArray();
    const spriteSheets = await db.collection('assets').find({ assetType: 'sprite_sheet' }).toArray();

    console.log(`Sprite Sheets: ${spriteSheets.length}`);
    if (spriteSheets.length > 0) {
      spriteSheets.forEach(sheet => {
        console.log(`   📋 ${sheet.title || sheet.name}`);
        console.log(`      Image: ${sheet.images?.fullscreen || 'N/A'}`);
      });
    }
    console.log('');

    console.log(`Individual Sprites: ${allSprites.length}`);
    if (allSprites.length === 0) {
      console.log('❌ No sprites found!');
      console.log('   → Import sprite sheet at: /assets/sprite-creator');
      console.log('   → You need a PNG image with your tiles');
    } else {
      console.log(`✅ Found ${allSprites.length} sprites`);

      // Group by parent zone
      const spritesByZone = {};
      allSprites.forEach(sprite => {
        const parent = sprite.hierarchy?.parent?.toString() || 'none';
        if (!spritesByZone[parent]) spritesByZone[parent] = [];
        spritesByZone[parent].push(sprite);
      });

      Object.entries(spritesByZone).forEach(([zoneId, sprites]) => {
        if (zoneId === 'none') {
          console.log(`   ⚠️  ${sprites.length} sprites not linked to any zone`);
        } else {
          const zone = allZones.find(z => z._id.toString() === zoneId);
          console.log(`   └─ ${sprites.length} sprites for: ${zone?.title || zoneId}`);
        }
      });
    }

    // 4. Summary & Next Steps
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('📊 SUMMARY & NEXT STEPS');
    console.log('═'.repeat(60));
    console.log('');

    const hasAnomalies = anomalies.length > 0;
    const hasZones = allZones.length > 0;
    const hasSprites = allSprites.length > 0;
    const anomaliesWithInteriors = anomalies.filter(a =>
      allZones.some(z => z.hierarchy?.parent?.toString() === a._id.toString())
    ).length;

    if (!hasAnomalies) {
      console.log('🎯 NEXT: Create your starship colony (anomaly)');
      console.log('   → Go to: /assets/builder-enhanced');
      console.log('   → Select "Anomaly" as type');
      console.log('   → Name it (e.g., "USS Enterprise")');
      console.log('');
    } else if (anomaliesWithInteriors === 0) {
      console.log('🎯 NEXT: Create interior floormap for your starship');
      console.log(`   → Go to: /universe/interior-map-builder?parentAssetId=${anomalies[0]._id}&parentAssetType=anomaly`);
      console.log('   → Design your ship layout');
      console.log('   → Click "Save as Zone Asset"');
      console.log('');
    } else if (!hasSprites) {
      console.log('🎯 NEXT: Create sprites for your interior');
      console.log('   → Prepare PNG sprite sheet (32x32 tiles)');
      console.log('   → Go to: /assets/sprite-creator');
      console.log('   → Import sprite sheet with JSON definition');
      console.log('');
    } else {
      console.log('✅ You have all the pieces!');
      console.log('');
      console.log('🎮 Ready to test:');
      console.log('   1. Go to galactic map: /universe/galactic-map-3d');
      console.log('   2. Click on your starship (anomaly)');
      console.log('   3. Click "Land Here"');
      console.log('   4. Explore your interior with sprites!');
      console.log('');
    }

    console.log('📚 Complete guide: /srv/ps/docs/STARSHIP_COLONY_WORKFLOW.md');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSetup();
