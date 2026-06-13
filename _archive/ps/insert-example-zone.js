import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const exampleZone = {
  zoneName: "Crystalline-Caverns-Alpha",
  displayName: "Crystalline Caverns Alpha",
  description: "A vast underground network of bioluminescent crystal formations. The caverns pulse with ethereal light from rare crystalline structures that have grown for millennia.",
  type: "underground",
  difficulty: "medium",
  coordinates: { x: 1500, y: -300, z: 2400 },
  dimensions: { width: 500, height: 200, depth: 800 },
  environment: {
    temperature: 15,
    humidity: 85,
    lighting: "bioluminescent",
    atmosphere: "breathable"
  },
  resources: [
    { name: "Luminite Crystal", rarity: "rare", quantity: "abundant" },
    { name: "Underground Water", rarity: "common", quantity: "moderate" }
  ],
  inhabitants: [
    { species: "Crystal Beetles", population: "high", hostility: "peaceful" }
  ],
  features: [
    "Natural crystal formations",
    "Underground lakes",
    "Bioluminescent flora",
    "Ancient mineral deposits"
  ],
  accessPoints: [
    { name: "North Entrance", coordinates: { x: 1500, y: -250, z: 2900 }, type: "natural" },
    { name: "Mining Shaft 7", coordinates: { x: 1800, y: -280, z: 2600 }, type: "constructed" }
  ],
  discoveredBy: "Planetary Survey Team Delta",
  discoveryDate: new Date("2025-03-15T10:30:00Z"),
  status: "active",
  safetyLevel: "monitored",
  tags: ["caves", "crystals", "bioluminescent", "mining", "exploration"],
  createdAt: new Date(),
  updatedAt: new Date()
};

async function insertExampleZone() {
  const client = new MongoClient(process.env.DB_URL);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(process.env.DB_NAME);
    const result = await db.collection('zones').insertOne(exampleZone);

    console.log('Example zone inserted successfully!');
    console.log('Inserted ID:', result.insertedId);
    console.log('Zone Name:', exampleZone.zoneName);

  } catch (error) {
    console.error('Error inserting zone:', error);
  } finally {
    await client.close();
    console.log('Connection closed');
  }
}

insertExampleZone();
