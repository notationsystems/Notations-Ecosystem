#!/usr/bin/env node
// Screenshot every lens of the dock (sample mode) with Playwright.
//   node scripts/screenshots.mjs [baseUrl=http://127.0.0.1:4173]
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../docs/media');
const base = process.argv[2] ?? 'http://127.0.0.1:4173';
await mkdir(out, { recursive: true });

/** Every lens, in rail order. The list the test in dock/test also reads. */
export const LENSES = ['Operator', 'Security', 'Corpus', 'Api', 'Solar', 'Map', 'Graph', 'Ledger', 'Timeline', 'Console'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('.tab', { timeout: 30000 });

const shot = async (name) => {
  const file = path.join(out, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
  return path.basename(file);
};
const lens = async (tab, settle = 2500) => {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(settle);
};

const written = [];
for (const tab of LENSES) {
  await lens(tab, tab === 'Map' ? 6000 : 2500);
  written.push(await shot(tab.toLowerCase()));
}

// The detail shots. Every one of these was captured by hand once and then drifted:
// `inspector-corpus.png` was still asserting 632 capabilities long after the catalog
// carried 634, in a picture no test can read. Selection is App state, so choosing a node
// in one lens and switching to another is how the focused shots are produced.
await lens('Corpus');
await page.locator('.sec-card').filter({ hasText: 'Payload Terminal' }).first().click();
await page.waitForTimeout(1200);
written.push(await shot('inspector-corpus'));

await lens('Map', 6000);
written.push(await shot('map-selected'));

await lens('Graph', 3500);
written.push(await shot('graph-focus'));

await lens('Security');
await page.locator('.sec-card').first().click();
await page.waitForTimeout(1200);
written.push(await shot('security-dimension'));

await lens('Console');
await page.getByRole('button', { name: 'Record posture', exact: true }).click();
await page.waitForTimeout(1200);
written.push(await shot('console-posture'));

// The ledger has records only when a control plane has them: the sample snapshot carries
// no coordination, and inventing one would be putting a decision nobody made into a
// shipped file. So this shot is taken against a live plane when a token is supplied.
//   CONTROL_PLANE_TOKEN=… node scripts/screenshots.mjs
const token = process.env.CONTROL_PLANE_TOKEN;
if (token) {
  // Close the inspector the detail shots left open, so the ledger's own columns are the
  // subject of the ledger's own picture.
  await page.locator('.inspector button', { hasText: '×' }).first().click().catch(() => {});
  await page.locator('input[type="password"]').fill(token);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.waitForTimeout(4000);
  await lens('Ledger');
  written.push(await shot('ledger-populated'));
} else {
  console.log('\nCONTROL_PLANE_TOKEN not set: skipping ledger-populated.png (needs a live plane with coordination records)');
  written.push('ledger-populated.png');
}

await browser.close();

// Any image in docs/media this run did not write is one nothing reproduces. It is a
// claim about the dock that no command can re-derive, which is the same defect as a
// count written down beside the thing it counts — and the harder one to notice.
const stale = (await readdir(out)).filter((f) => f.endsWith('.png') && !written.includes(f));
if (stale.length) {
  console.log(`\n${stale.length} image(s) in docs/media this run did not produce:`);
  for (const f of stale) console.log(`  ${f} — nothing regenerates it; delete it or add it above`);
}
if (errors.length) { console.log('console/page errors:'); for (const e of errors) console.log('  ' + e.slice(0, 300)); }
process.exit(stale.length ? 1 : 0);
