#!/usr/bin/env node
// Copy the Payload layer manifest + data from ecosystem/payload into the dock's public dir.
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../../ecosystem/payload');
const dst = path.resolve(here, '../public/layers/payload');
await mkdir(dst, { recursive: true });
await cp(path.join(src, 'layers.json'), path.join(dst, 'layers.json'));
const files = (await readdir(path.join(src, 'layers'))).filter((f) => f.endsWith('.json'));
for (const f of files) await cp(path.join(src, 'layers', f), path.join(dst, f));
console.log(`synced layers.json + ${files.length} layer files -> ${path.relative(process.cwd(), dst)}`);
