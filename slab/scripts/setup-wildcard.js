#!/usr/bin/env node
/**
 * Slab — Generate wildcard Apache confs for *.madladslab.com
 * Run once: node scripts/setup-wildcard.js
 *
 * After running:
 *   a2ensite slab-wildcard.conf slab-wildcard-le-ssl.conf
 *   systemctl reload apache2
 *
 * For wildcard SSL cert (if not already done):
 *   certbot certonly --manual --preferred-challenges dns -d '*.madladslab.com' -d madladslab.com
 */

import { generateWildcardConf } from '../plugins/provision.js';
import { config } from '../config/config.js';

const port = process.argv[2] || config.PORT || 3601;
console.log(`Generating wildcard confs for *.madladslab.com → port ${port}...`);

const { confPath, sslConfPath } = generateWildcardConf({ port });
console.log(`\nDone! Next steps:`);
console.log(`  1. a2ensite slab-wildcard.conf slab-wildcard-le-ssl.conf`);
console.log(`  2. systemctl reload apache2`);
console.log(`\nIf you need a wildcard SSL cert:`);
console.log(`  certbot certonly --manual --preferred-challenges dns -d '*.madladslab.com' -d madladslab.com`);
