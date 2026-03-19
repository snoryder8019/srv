import dotenv from 'dotenv';
dotenv.config();

export const config = {
  PORT: process.env.PORT || 3601,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DOMAIN: process.env.DOMAIN || 'http://localhost:3601',
  DB_URL: process.env.DB_URL,
  DB_NAME: process.env.DB_NAME || 'madLadsLab',
  GGLCID: process.env.GGLCID,
  GGLSEC: process.env.GGLSEC,
  JWT_SECRET: process.env.JWT_SECRET || 'dev_secret_change_me',
  SESHSEC: process.env.SESHSEC || 'dev_session_secret',
};
