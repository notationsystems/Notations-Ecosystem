// Build the offline instance: fold a throwaway plane, then carry both the fold and its journal
// into a single self-contained page. The page re-folds the journal itself and says on its face
// whether its own fold reached the same head, so the instance is checkable, not merely asserted.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportTwinData } from './export.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLACEHOLDER = '__DATA__';
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

// Embedded JSON leaves the parser's reach for a closing tag, and the two Unicode separators are
// newlines to a JSON parser but not to a string literal, so both are escaped before they land.
export function embed(data) {
  return JSON.stringify(data)
    .split('</').join('<\\/')
    .split(LINE_SEPARATOR).join('\\u2028')
    .split(PARAGRAPH_SEPARATOR).join('\\u2029');
}

export async function buildInstance(target) {
  const template = await readFile(path.join(here, 'instance.template.html'), 'utf8');
  if (!template.includes(PLACEHOLDER)) throw new Error('template carries no data placeholder');
  const data = await exportTwinData();
  const page = template.replace(PLACEHOLDER, () => embed(data));
  await writeFile(target, page);
  return { target, bytes: page.length, nodes: data.snapshot.nodes.length, events: data.events.length, revision: data.snapshot.revision };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] ?? path.join(here, 'notations-control-universe.html');
  const built = await buildInstance(target);
  console.log(`${built.target}\n${built.bytes} bytes · ${built.nodes} nodes · ${built.events} records · revision ${built.revision.slice(0, 12)}`);
}
