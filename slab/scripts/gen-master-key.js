#!/usr/bin/env node
/**
 * Generate a MASTER_KEY for Slab's AES-256-GCM encryption.
 * Add the output to your .env file.
 */
import { randomBytes } from 'crypto';
const key = randomBytes(32).toString('hex');
console.log(`MASTER_KEY=${key}`);
