import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config(); // Load environment variables

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`
    );
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error('Database connection error:', err);
    process.exit(1);
  }
};
