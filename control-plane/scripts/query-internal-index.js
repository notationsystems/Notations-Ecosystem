import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { queryOperationalIndex } from '../src/indexing/operational-index.js';

const indexPath = resolve(process.cwd(), process.env.CONTROL_PLANE_INDEX_PATH || 'data/control-plane-index.json');
const query = process.argv.slice(2).join(' ');
let index;
try {
  index = JSON.parse(await readFile(indexPath, 'utf8'));
} catch (error) {
  console.error(`Could not read internal index at ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Run npm run index:rebuild first.');
  process.exit(65);
}
console.log(JSON.stringify(queryOperationalIndex(index, query), null, 2));
