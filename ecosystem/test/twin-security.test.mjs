import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildInstance } from '../twin/build.mjs';

const build = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'twin-sec-'));
  await buildInstance(path.join(dir, 'p.html'));
  const page = await readFile(path.join(dir, 'p.html'), 'utf8');
  await rm(dir, { recursive: true, force: true });
  return page;
};

/**
 * SEC-047 — every third-party script the published instance executes is pinned by version and
 * bound by subresource integrity.
 *
 * The renderer runs with full DOM access in a page that is published and shared. Pinning a version
 * stops an upgrade from changing behaviour; integrity stops the same URL from serving different
 * bytes. Without the second, the first is a naming convention rather than a control.
 */
test('SEC-047: every remote script is pinned and integrity-bound', async () => {
  const page = await build();
  const tags = [...page.matchAll(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*>/g)];
  assert.ok(tags.length > 0, 'the instance loads a renderer; if it stopped, this test should be removed deliberately');
  for (const [tag, src] of tags) {
    assert.match(src, /@\d+\.\d+\.\d+\//, `${src} is not pinned to an exact version`);
    assert.match(tag, /integrity="sha(256|384|512)-[A-Za-z0-9+/=]{20,}"/, `${src} carries no subresource integrity`);
    // The browser only enforces integrity on a cross-origin script when the request is CORS-mode.
    assert.match(tag, /crossorigin="anonymous"/, `${src} has integrity but no crossorigin, so the check is not enforced`);
  }
});

test('SEC-047: the pinned integrity hash is the hash of the pinned bytes', async (t) => {
  const page = await build();
  const [, src, algo, digest] = page.match(/<script\b[^>]*\bsrc="(https?:[^"]+)"[^>]*integrity="sha(\d+)-([A-Za-z0-9+/=]+)"/s) ?? [];
  assert.ok(src && digest, 'the renderer tag should carry a src and an integrity digest');
  let bytes;
  try {
    const res = await fetch(src, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return t.skip(`the pinned bundle could not be fetched (${res.status}); the hash is unverified here`);
    bytes = Buffer.from(await res.arrayBuffer());
  } catch {
    return t.skip('no network in this environment; the hash is unverified here');
  }
  const actual = createHash(`sha${algo}`).update(bytes).digest('base64');
  assert.equal(actual, digest, `the bundle at ${src} no longer matches the pinned digest`);
});

/**
 * SEC-048 — no catalog text reaches the published page as markup.
 *
 * The instance renders names, descriptions, capability labels and observation detail into the DOM.
 * All of it originates in the catalog, which is edited by people and assembled by tooling. Text that
 * became markup would be stored XSS in a page that is published and shared.
 */
test('SEC-048: hostile catalog text is escaped, not rendered', async () => {
  const page = await build();
  // The one place page-authored markup is allowed is the template itself; the fold is data.
  const open = page.indexOf('id="twin-data"');
  const body = page.slice(page.indexOf('>', open) + 1, page.indexOf('</script>', open));
  assert.equal(body.includes('</'), false, 'the embedded fold can close the element it sits in');

  // Every sink that writes data into the DOM must route through esc(); this asserts the helper
  // exists and is applied wherever a snapshot field is interpolated into an innerHTML template.
  assert.match(page, /const esc = \(s\) =>/, 'the escaping helper is gone');
  const template = page.slice(0, open);
  const sinks = [...template.matchAll(/innerHTML\s*=\s*`([^`]*)`/g)].map(([, body_]) => body_);
  for (const sink of sinks) {
    for (const [, expr] of sink.matchAll(/\$\{([^}]*)\}/g)) {
      const readsData = /\b(node|n|cap|c|m|r|q|s|b|entry)\./.test(expr) && !/\.length\b/.test(expr);
      if (!readsData) continue;
      assert.ok(/esc\(|short\(|fmt\(|nodeLink\(|COLOR|\?\?\s*'/.test(expr),
        `an innerHTML template interpolates "${expr.trim().slice(0, 70)}" without escaping it`);
    }
  }
});
