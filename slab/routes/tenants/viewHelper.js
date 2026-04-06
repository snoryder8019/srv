/**
 * Tenant-aware view resolution.
 *
 * Tries: views/tenants/<subdomain>/<template>.ejs
 * Falls back to: views/<template>.ejs
 */
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsRoot = path.resolve(__dirname, '../../views');

export function tenantRender(req, res, template, locals = {}) {
  const sub = req.tenant?.meta?.subdomain;
  if (sub) {
    const tenantView = path.join(viewsRoot, 'tenants', sub, `${template}.ejs`);
    if (fs.existsSync(tenantView)) {
      return res.render(`tenants/${sub}/${template}`, locals);
    }
  }
  // Fallback to shared view
  res.render(template, locals);
}
