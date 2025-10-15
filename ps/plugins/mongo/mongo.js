import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

let _db; // Store the database connection
let _client; // Store the client connection

export const connectDB = async () => {
  if (!_db) {
    try {
      _client = new MongoClient(process.env.DB_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });

      await _client.connect();
      _db = _client.db(process.env.DB_NAME);
      console.log("✅ Connected to MongoDB: " + process.env.DB_NAME);

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
