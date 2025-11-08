/**
 * Quick script to list media in graffiti-tv bucket from database
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load from parent directory
dotenv.config({ path: '../madladslab/.env' });

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.DB_URL);
    console.log('MongoDB connected');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

// Asset schema
const assetSchema = new mongoose.Schema({
  filename: String,
  originalName: String,
  bucket: String,
  subdirectory: String,
  bucketPath: String,
  publicUrl: String,
  fileType: String,
  mimeType: String,
  size: Number,
  uploadedAt: { type: Date, default: Date.now }
});

const Asset = mongoose.model('Asset', assetSchema);

async function listMedia() {
  await connectDB();

  const assets = await Asset.find({ bucket: 'graffiti-tv' }).sort({ uploadedAt: -1 });

  if (assets.length === 0) {
    console.log('\nNo media found in graffiti-tv bucket in database.');
    console.log('\nYou can:');
    console.log('1. Upload media via the bucket upload interface');
    console.log('2. Manually add URLs to routes/api.js');
    console.log('\nExample URLs to add:');
    console.log('const mediaItems = [');
    console.log('  { url: `${baseUrl}/your-video.mp4`, type: \'video\' },');
    console.log('  { url: `${baseUrl}/your-image.jpg`, type: \'image\' },');
    console.log('];');
  } else {
    console.log(`\n=== Found ${assets.length} media files in graffiti-tv bucket ===\n`);

    const mediaItems = [];

    assets.forEach((asset, index) => {
      console.log(`${index + 1}. ${asset.originalName}`);
      console.log(`   Type: ${asset.fileType}`);
      console.log(`   URL: ${asset.publicUrl}`);
      console.log(`   Size: ${(asset.size / 1024 / 1024).toFixed(2)} MB`);
      console.log('');

      mediaItems.push({
        url: asset.publicUrl,
        type: asset.fileType === 'video' ? 'video' : 'image',
      });
    });

    console.log('\n=== Copy/Paste into routes/api.js ===\n');
    console.log('const mediaItems = [');
    mediaItems.forEach((item, index) => {
      const comma = index < mediaItems.length - 1 ? ',' : '';
      console.log(`      { url: '${item.url}', type: '${item.type}' }${comma}`);
    });
    console.log('    ];');
  }

  await mongoose.connection.close();
  process.exit(0);
}

listMedia();
