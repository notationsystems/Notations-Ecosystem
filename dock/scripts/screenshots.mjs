#!/usr/bin/env node
// Screenshot every lens of the dock (sample mode) with Playwright.
//   node scripts/screenshots.mjs [baseUrl=http://127.0.0.1:4173]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../docs/media');
const base = process.argv[2] ?? 'http://127.0.0.1:4173';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.tab', { timeout: 30000 });
for (const tab of ['Operator', 'Map', 'Graph', 'Ledger', 'Timeline', 'Console']) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(tab === 'Map' ? 6000 : 2500);
  const file = path.join(out, `${tab.toLowerCase()}.png`);
  await page.screenshot({ path: file });
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}
await browser.close();
if (errors.length) { console.log('console/page errors:'); for (const e of errors) console.log('  ' + e.slice(0, 300)); }
