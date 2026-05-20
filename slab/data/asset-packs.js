// Catalog of free, dev-friendly asset packs that tenants can import into
// their library. Each pack is fetched on demand from jsDelivr — no files
// are bundled in the repo. SVGs are streamed to tenant S3 on import.
//
// Licenses are all permissive (MIT / ISC / CC0) — safe for commercial use.
// To add a pack: append to PACKS and ensure jsDelivr serves the package.

export const PACKS = [
  {
    id: 'heroicons-outline',
    name: 'Heroicons (Outline)',
    kind: 'icon',
    license: 'MIT',
    source: 'https://heroicons.com',
    pkg: 'heroicons',
    pkgVersion: '2.1.5',
    pathPrefix: '24/outline/',
    extension: '.svg',
  },
  {
    id: 'heroicons-solid',
    name: 'Heroicons (Solid)',
    kind: 'icon',
    license: 'MIT',
    source: 'https://heroicons.com',
    pkg: 'heroicons',
    pkgVersion: '2.1.5',
    pathPrefix: '24/solid/',
    extension: '.svg',
  },
  {
    id: 'lucide',
    name: 'Lucide',
    kind: 'icon',
    license: 'ISC',
    source: 'https://lucide.dev',
    pkg: 'lucide-static',
    pkgVersion: 'latest',
    pathPrefix: 'icons/',
    extension: '.svg',
  },
  {
    id: 'tabler-outline',
    name: 'Tabler Icons (Outline)',
    kind: 'icon',
    license: 'MIT',
    source: 'https://tabler.io/icons',
    pkg: '@tabler/icons',
    pkgVersion: 'latest',
    pathPrefix: 'icons/outline/',
    extension: '.svg',
  },
  {
    id: 'tabler-filled',
    name: 'Tabler Icons (Filled)',
    kind: 'icon',
    license: 'MIT',
    source: 'https://tabler.io/icons',
    pkg: '@tabler/icons',
    pkgVersion: 'latest',
    pathPrefix: 'icons/filled/',
    extension: '.svg',
  },
];

export function getPack(id) {
  return PACKS.find(p => p.id === id) || null;
}

// jsDelivr's data API treats "latest" as a literal version (→ 404). The CDN
// resolves it fine, but for the listing endpoint we have to omit it.
function pinnedVer(pack) {
  return pack.pkgVersion && pack.pkgVersion !== 'latest' ? '@' + pack.pkgVersion : '';
}

export function fileUrl(pack, name) {
  const ver = pinnedVer(pack);
  return `https://cdn.jsdelivr.net/npm/${pack.pkg}${ver}/${pack.pathPrefix}${name}${pack.extension}`;
}

export function listingUrl(pack) {
  const ver = pinnedVer(pack);
  return `https://data.jsdelivr.com/v1/packages/npm/${pack.pkg}${ver}?structure=flat`;
}
