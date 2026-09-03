#!/usr/bin/env node
/**
 * Copy every ecosystem adapter's spatial layers into the dock's public dir.
 *
 * PAYLOAD_FIRST.md promises that "the next ecosystem adds catalog nodes, an
 * `ecosystem/<name>/` adapter and, if it has geography, a `layers.json`". This script
 * used to name `ecosystem/payload` in its source, so that promise was true of the
 * catalog and false of the tooling: a second adapter would have been extracted, ignored
 * by the sync, and invisible in the dock.
 *
 * It discovers adapters instead. Any `ecosystem/<name>/layers.json` with a `layers/`
 * directory beside it is one, and an index lists what was found so the dock does not
 * have to guess either.
 */
import { cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ecosystem = path.resolve(here, '../../ecosystem');
const root = path.resolve(here, '../public/layers');

const exists = async (p) => { try { await stat(p); return true; } catch { return false; } };

const adapters = [];
for (const entry of (await readdir(ecosystem, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isDirectory() || entry.name === 'catalog' || entry.name === 'test' || entry.name === 'node_modules') continue;
  const manifest = path.join(ecosystem, entry.name, 'layers.json');
  const layers = path.join(ecosystem, entry.name, 'layers');
  if (await exists(manifest) && await exists(layers)) adapters.push({ name: entry.name, manifest, layers });
}

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const index = [];
for (const adapter of adapters) {
  const dst = path.join(root, adapter.name);
  await mkdir(dst, { recursive: true });
  await cp(adapter.manifest, path.join(dst, 'layers.json'));
  const files = (await readdir(adapter.layers)).filter((f) => f.endsWith('.json'));
  for (const f of files) await cp(path.join(adapter.layers, f), path.join(dst, f));
  const { layers = [] } = JSON.parse(await readFile(adapter.manifest, 'utf8'));
  index.push({ adapter: adapter.name, layers: layers.length, files: files.length });
  console.log(`${adapter.name}: layers.json + ${files.length} files -> ${path.relative(process.cwd(), dst)}`);
}

await writeFile(path.join(root, 'index.json'), `${JSON.stringify({ schema: 'notations.dock.layer-adapters.v1', adapters: index }, null, 2)}\n`);
if (!adapters.length) console.log('no ecosystem adapter carries a layers.json; the map will draw the universe alone');
