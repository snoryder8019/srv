/**
 * Database configuration
 */
import dotenv from 'dotenv';

dotenv.config();

export const dbConfig = {
  url: process.env.DB_URL,
  name: process.env.DB_NAME,
  options: {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
};

export const collections = {
  users: 'users',
  characters: 'characters',
  zones: 'zones',
  species: 'species',
  talentTrees: 'talentTrees',
  galacticState: 'galacticState',
  planetaryState: 'planetaryState',
  sessions: 'sessions',
  assets: 'assets',
  userActions: 'userActions'
};

export default {
  dbConfig,
  collections
};
