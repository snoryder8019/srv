#!/usr/bin/env node
import dotenv from 'dotenv';
import { connectDB, getDb } from '../plugins/mongo/mongo.js';
import MOTD from '../api/v1/models/MOTD.js';

dotenv.config();

async function createInitialMOTD() {
  try {
    console.log('🚀 Creating initial MOTD...\n');

    // Connect to database
    await connectDB();

    // Give Mongoose models time to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check if MOTD already exists
    const existing = await MOTD.getCurrentMOTD();
    if (existing) {
      console.log('✅ Active MOTD already exists!');
      console.log(`   ID: ${existing._id}`);
      console.log(`   Welcome: ${existing.welcomeMessage}`);
      console.log(`   Created: ${existing.createdAt}`);
      process.exit(0);
    }

    // Create new MOTD
    const motd = new MOTD({
      welcomeMessage: 'Thank you and welcome to a new day in the Stringborn Universe!',
      message: 'We are actively developing new features and expanding the universe. Your feedback and participation help shape the future of this community-driven MMO experience. Check out the latest patch notes for recent updates and improvements!',
      ctaText: 'We need asset design testers! If you want to make an NPC and write an arc, or create a texture pack in the sprite world builder, jump right in!',
      ctaLink: '/menu',
      ctaLinkText: 'Visit the Menu',
      isActive: true,
      priority: 0
    });

    await motd.save();

    console.log('✅ Initial MOTD created successfully!');
    console.log(`   ID: ${motd._id}`);
    console.log(`   Welcome: ${motd.welcomeMessage}`);
    console.log(`   Message: ${motd.message}`);
    console.log(`   CTA: ${motd.ctaText}`);
    console.log(`   Link: ${motd.ctaLink}`);
    console.log(`   Active: ${motd.isActive}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating initial MOTD:', error);
    process.exit(1);
  }
}

createInitialMOTD();
