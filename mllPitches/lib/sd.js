import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SD_OUT_DIR = path.resolve(__dirname, '..', 'public', 'images', 'proposal');

const SD_BASE = process.env.OLLAMA_URL || 'https://ollama.madladslab.com';
const SD_KEY = process.env.OLLAMA_KEY || '';
const SD_SIZE = process.env.SD_SIZE || '768x512';

export const PROPOSAL_DESIGN_PROMPTS = {
  summit:
    'cinematic aerial photograph of granite alpine summits at dawn, low cloud layers slipping between peaks, deep teal sky, sharp directional light, large-format photography, no people, no text, no logos, premium magazine cover composition',
  trailhead:
    'sweeping panoramic painting of indigo blue rocky mountain ridges layered into the distance, soft topographic line texture overlay, twilight palette, minimalist contemporary editorial style, no people, no text, no logos',
  ridgeline:
    'slate gray rocky ridge under a copper sunset, dramatic chiaroscuro, fine art landscape photography, low warm sun raking across stone, no people, no text, no logos, premium financial brochure mood',
  evergreen:
    'tall evergreen pine forest at golden hour, deep green canopy with shafts of warm parchment light, fine mist between trunks, fine art photograph, restrained boardroom aesthetic, no people, no text, no logos',
  highcountry:
    'high country desert plateau at sunset, sand dunes and distant mesas in soft orange and ochre, long shadows, expansive horizon, fine art landscape photography, no people, no text, no logos',
};

function fileFor(design) {
  return path.join(SD_OUT_DIR, `${design}.png`);
}

export function existingImage(design) {
  const fp = fileFor(design);
  return fs.existsSync(fp) ? fp : null;
}

export async function generateImage(design, { force = false } = {}) {
  if (!fs.existsSync(SD_OUT_DIR)) fs.mkdirSync(SD_OUT_DIR, { recursive: true });
  const fp = fileFor(design);
  if (!force && fs.existsSync(fp)) return fp;

  const prompt = PROPOSAL_DESIGN_PROMPTS[design];
  if (!prompt) throw new Error(`unknown design: ${design}`);

  const headers = { 'Content-Type': 'application/json' };
  if (SD_KEY) headers.Authorization = `Bearer ${SD_KEY}`;

  const r = await fetch(`${SD_BASE}/v1/images/generations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt, n: 1, size: SD_SIZE }),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`SD upstream ${r.status}: ${txt.slice(0, 200)}`);
  }
  const j = await r.json();
  const b64 = j?.data?.[0]?.b64_json;
  if (!b64) throw new Error('SD response missing b64_json');
  fs.writeFileSync(fp, Buffer.from(b64, 'base64'));
  return fp;
}

export function listMissing() {
  return Object.keys(PROPOSAL_DESIGN_PROMPTS).filter((id) => !existingImage(id));
}
