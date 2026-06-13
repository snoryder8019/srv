#!/usr/bin/env node
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });

const DB_URL = process.env.DB_URL;
const DB_NAME = process.env.DB_NAME;

async function checkPlanetChunks() {
  const client = new MongoClient(DB_URL);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection('planetChunks');

    // Get a sample document
    const sample = await collection.findOne();
    console.log('Sample planetChunk document:');
    console.log(JSON.stringify(sample, null, 2).substring(0, 2000));

    const size = JSON.stringify(sample).length;
    console.log(`\nSample size: ${(size / 1024).toFixed(2)} KB`);
    console.log(`Est. total for 791 docs: ${(size * 791 / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.close();
  }
}

checkPlanetChunks();
