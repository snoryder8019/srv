import mongoose from 'mongoose';
import {config} from '../../config/config.js'
export const connectDB = async () => {
  try {
    // DB_URL already contains the full connection string including mongodb+srv://
    const connectionString = config.DB_URL.includes('mongodb')
      ? `${config.DB_URL}/${config.DB_NAME}?retryWrites=true&w=majority`
      : `mongodb://${config.DB_URL}/${config.DB_NAME}?retryWrites=true&w=majority`;

    const conn = await mongoose.connect(connectionString);
    console.log(`✅ Mongoose connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('❌ Mongoose connection error:', err);
    process.exit(1);
  }
};
