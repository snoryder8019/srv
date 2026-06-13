/**
 * @madlads/siege-kit
 * Shared protocol + pure logic for siege/attack instances.
 * See /srv/SIEGE_KIT_PROTOCOL.md for the full contract.
 *
 * Split by environment:
 *   - descriptor / skins / economy : pure, browser-safe (import anywhere)
 *   - token                        : server-only (uses node:crypto)
 */
export * from './descriptor.js';
export * from './skins.js';
export * from './economy.js';

// token is server-only; import it directly from '@madlads/siege-kit/token'
// in server code to avoid pulling node:crypto into a browser bundle.
