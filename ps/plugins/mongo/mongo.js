import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let _db; // Store the database connection
let _client; // Store the client connection

export const connectDB = async () => {
  if (!_db) {
    try {
      // Remove deprecated options (useNewUrlParser and useUnifiedTopology)
      // These are default in MongoDB driver 4.0.0+
      _client = new MongoClient(process.env.DB_URL);

      await _client.connect();
      _db = _client.db(process.env.DB_NAME);
      console.log("✅ Connected to MongoDB: " + process.env.DB_NAME);

      // Start physics service after DB is connected
      try {
        const physicsService = (await import('../../services/physics-service.js')).default;
        physicsService.start();
        console.log('⚙️ Physics Service started with galactic orbit physics');
      } catch (err) {
        console.error('⚠️ Failed to start physics service:', err.message);
      }

      return _db;
    } catch (err) {
      console.error("❌ Error connecting to MongoDB:", err);
      throw new Error("Database connection failed");
    }
  }
  return _db;
};

export const getDb = () => {
  if (!_db) {
    throw new Error("Database not initialized");
  }
  return _db;
};

export const closeDB = async () => {
  if (_client) {
    await _client.close();
    console.log("✅ MongoDB connection closed");
  }
};
