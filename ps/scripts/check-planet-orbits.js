import mongoose from 'mongoose';
import Asset from '../api/v1/models/Asset.js';

mongoose.connect('mongodb://localhost:27017/projectStringborne', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  const planets = await Asset.find({
    assetType: 'planet',
    orbitRadius: { $exists: true }
  }).select('title orbitRadius orbitAngle').sort({ orbitRadius: 1 }).limit(20);

  console.log('Inner planets (sorted by orbitRadius):');
  console.log('=====================================');
  planets.forEach(p => {
    const scaled = p.orbitRadius * 150;
    const status = scaled < 500 ? '❌ TOO CLOSE' : '✅ OK';
    console.log(`${p.title.padEnd(30)} | orbitRadius: ${p.orbitRadius.toFixed(1).padStart(8)} | scaled (150x): ${scaled.toFixed(0).padStart(8)} units ${status}`);
  });

  process.exit(0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
