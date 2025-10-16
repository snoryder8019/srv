#!/usr/bin/env node
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Location from '../api/v1/models/lbb/Location.js';
import Reward from '../api/v1/models/lbb/Reward.js';

dotenv.config();

const sampleLocations = [
  {
    name: "The Mad Lad's Pub",
    type: 'pub',
    address: {
      street: '123 Main St',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'USA'
    },
    coordinates: {
      type: 'Point',
      coordinates: [-97.7431, 30.2672] // Austin, TX
    },
    description: 'The best pub in town with craft beers and live music',
    checkInRadius: 100,
    isActive: true
  },
  {
    name: 'Sunset Lounge',
    type: 'lounge',
    address: {
      street: '456 Oak Ave',
      city: 'Austin',
      state: 'TX',
      zipCode: '78702',
      country: 'USA'
    },
    coordinates: {
      type: 'Point',
      coordinates: [-97.7261, 30.2669]
    },
    description: 'Upscale cocktail lounge with rooftop views',
    checkInRadius: 75,
    isActive: true
  },
  {
    name: 'Downtown Bar & Grill',
    type: 'bar',
    address: {
      street: '789 Congress Ave',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'USA'
    },
    coordinates: {
      type: 'Point',
      coordinates: [-97.7437, 30.2652]
    },
    description: 'Sports bar with great food and drinks',
    checkInRadius: 50,
    isActive: true
  }
];

const sampleRewards = [
  {
    title: 'Welcome Bonus',
    description: 'Get 50 bonus points for being a new member!',
    type: 'points_multiplier',
    pointsCost: 0,
    value: '+50 points',
    isGlobal: true,
    isActive: true
  },
  {
    title: 'Free Appetizer',
    description: 'Redeem for a free appetizer at any participating location',
    type: 'free_item',
    pointsCost: 100,
    value: 'Free appetizer',
    isGlobal: true,
    isActive: true
  },
  {
    title: '20% Off Next Visit',
    description: 'Get 20% off your entire bill on your next visit',
    type: 'discount',
    pointsCost: 150,
    value: '20% off',
    isGlobal: true,
    isActive: true
  },
  {
    title: 'VIP Access',
    description: 'Skip the line and get priority seating',
    type: 'special_access',
    pointsCost: 300,
    value: 'VIP treatment',
    isGlobal: true,
    isActive: true,
    requirements: {
      minCheckIns: 10,
      minPoints: 300
    }
  },
  {
    title: 'Happy Hour Hero',
    description: 'Unlock 2x points during happy hour',
    type: 'points_multiplier',
    pointsCost: 200,
    value: '2x points multiplier',
    isGlobal: true,
    isActive: true
  }
];

async function seedData() {
  try {
    // Connect to MongoDB
    const connectionString = process.env.DB_URL.includes('mongodb')
      ? `${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`
      : `mongodb://${process.env.DB_URL}/${process.env.DB_NAME}?retryWrites=true&w=majority`;

    await mongoose.connect(connectionString);
    console.log('✅ Connected to MongoDB');

    // Clear existing data (optional - comment out if you want to keep existing data)
    await Location.deleteMany({});
    await Reward.deleteMany({});
    console.log('🗑️  Cleared existing data');

    // Insert sample locations
    const locations = await Location.insertMany(sampleLocations);
    console.log(`✅ Created ${locations.length} locations`);

    // Insert sample rewards
    const rewards = await Reward.insertMany(sampleRewards);
    console.log(`✅ Created ${rewards.length} rewards`);

    console.log('\n🎉 Seed data created successfully!');
    console.log('\nSample locations:');
    locations.forEach(loc => {
      console.log(`  - ${loc.name} (${loc.type})`);
    });

    console.log('\nSample rewards:');
    rewards.forEach(reward => {
      console.log(`  - ${reward.title} (${reward.pointsCost} pts)`);
    });

  } catch (error) {
    console.error('❌ Error seeding data:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
    process.exit(0);
  }
}

seedData();
