import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/claude-sandbox';
  try {
    await mongoose.connect(uri);
    console.log('MongoDB connected');
  } catch (err) {
    console.warn('MongoDB not available — running without database:', err.message);
  }
}
