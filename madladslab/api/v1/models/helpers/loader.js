////api/v1/models/loader.js **GPT NOTE: DONT REMOVE THIS LINE IN EXAMPLES**
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

export async function getModelClass(name) {
  const p = path.join(process.cwd(), 'api/v1/models/grafitti', `${name}.js`);
  if (!fs.existsSync(p)) throw new Error(`Model ${name} not found`);
  const { default: ModelClass } = await import(pathToFileURL(p).href);
  return ModelClass;
}
export async function getModelInstance(name) {
  const ModelClass = await getModelClass(name);
  return new ModelClass();
}
