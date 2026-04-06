/**
 * Tenant Route Loader
 *
 * Auto-discovers and mounts tenant-specific routes from routes/tenants/<name>/.
 * Each tenant folder should export a default Express router from index.js.
 *
 * Matching logic: checks req.tenant.meta.subdomain against folder names.
 * Routes are mounted at /t/<tenantName>/... so they never collide with core routes.
 *
 * Usage in app.js:
 *   import { mountTenantRoutes } from './routes/tenants/loader.js';
 *   mountTenantRoutes(app);
 */
import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Scans routes/tenants/ for subdirectories with an index.js,
 * imports each, and mounts them behind a tenant-gate middleware.
 */
export async function mountTenantRoutes(app) {
  const entries = fs.readdirSync(__dirname, { withFileTypes: true });
  const tenantDirs = entries.filter(e => e.isDirectory());

  for (const dir of tenantDirs) {
    const indexPath = path.join(__dirname, dir.name, 'index.js');
    if (!fs.existsSync(indexPath)) continue;

    const tenantName = dir.name; // e.g. 'slab', 'madladslab'
    const mod = await import(`./${tenantName}/index.js`);
    const router = mod.default;

    if (!router) {
      console.warn(`[tenant-loader] ${tenantName}/index.js has no default export, skipping`);
      continue;
    }

    // Gate: only allow requests from the matching tenant
    const gated = Router();
    gated.use((req, res, next) => {
      const sub = req.tenant?.meta?.subdomain;
      if (sub === tenantName) return next();
      next('route'); // skip — not this tenant
    });
    gated.use(router);

    app.use(`/custom`, gated);
    console.log(`[tenant-loader] mounted /custom routes for "${tenantName}"`);
  }
}
