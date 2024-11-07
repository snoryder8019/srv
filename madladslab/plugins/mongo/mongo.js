import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();
let db;

export default async function connect() {
  const client = new MongoClient(`mongodb+srv://${process.env.MON_USER}:${process.env.MON_PASS}@cluster0.tpmae.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`);
  
  try {
    await client.connect();
    db = client.db('madladslab'); // Make sure to use your database name from the environment variable
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    throw new Error('Database connection failed');
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db;
}
