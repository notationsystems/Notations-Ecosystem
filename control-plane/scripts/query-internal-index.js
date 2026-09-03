#!/usr/bin/env node
/**
 * Query a rebuilt operational index.
 *
 *   node scripts/query-internal-index.js [--index <path>] [--kind api] [--health offline]
 *                                        [--posture stale] [--maturity planned] <words…>
 *
 * Every word must match a token of the node's declared topology. Purpose text and
 * signature bytes were never indexed, so no query here can surface them.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { queryOperationalIndex } from '../src/indexing/operational-index.js';

const args = process.argv.slice(2);
const filters = {};
const words = [];
for (let i = 0; i < args.length; i += 1) {
  const match = /^--(index|kind|health|posture|maturity)$/.exec(args[i]);
  if (match && args[i + 1] !== undefined) { filters[match[1]] = args[i + 1]; i += 1; } else words.push(args[i]);
}
const indexPath = resolve(filters.index ?? process.env.CONTROL_PLANE_JOURNAL_PATH?.replace(/[^/]+$/, 'control-plane-index.json') ?? 'data/control-plane-index.json');
delete filters.index;

let index;
try {
  index = JSON.parse(await readFile(indexPath, 'utf8'));
} catch (error) {
  console.error(`Could not read an index at ${indexPath}: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Run `npm run index:rebuild` first.');
  process.exit(65);
}
console.log(JSON.stringify(queryOperationalIndex(index, words.join(' '), filters), null, 2));
