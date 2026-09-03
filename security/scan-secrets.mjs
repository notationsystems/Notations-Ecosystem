#!/usr/bin/env node
/**
 * Repository secret scan.
 *
 * SEC-004 says no secret may be committed. This makes that checkable rather than
 * hoped for: it walks the working tree (or a list of files), applies the same
 * credential detector the control plane enforces at its API boundary, and exits
 * non-zero on a finding.
 *
 *   node security/scan-secrets.mjs                 # whole tree
 *   node security/scan-secrets.mjs --staged        # what is about to be committed
 *   node security/scan-secrets.mjs path/to/file    # specific paths
 *
 * A walk of the working tree also sees runtime state git is told to ignore — a signing
 * key store, a credential registry. That material is real but cannot be committed, so it
 * is reported as *held* and does not fail the run. Under `--staged` nothing is held:
 * a staged file is on its way into history by definition.
 *
 * Findings print the file, line and the rule that fired. The matched text is NOT
 * printed: a scanner that echoes secrets into CI logs has moved the exposure rather
 * than removed it.
 */

import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectSecretShape } from '../control-plane/src/security/text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', 'layers']);
const SKIP_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.tgz', '.woff', '.woff2', '.ttf', '.mp4', '.mov', '.parquet', '.wasm']);
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const MAX_BYTES = 2_000_000;
const MAX_LINE = 4_000;

/** Files whose whole purpose is to describe credential handling, checked more loosely. */
const DOCUMENTATION = /\.(?:md|mdx)$/i;

/** An in-place exemption, which must carry a reason: `secret-scan:allow <reason>`. */
const ALLOW_MARKER = /secret-scan:allow\s+\S+/;

/**
 * Source code assigns to fields called `privateKey` and `password` all the time, and
 * the value is a variable or a call rather than material. The API boundary detector
 * stays strict — it sees values, not programs — while the repository scanner is
 * allowed to know it is reading code.
 */
const CODE_ASSIGNMENT = /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|passwd)\b\s*[:=]\s*([A-Za-z_$][\w$]*)\s*(?:[(.,;)\]}]|$)/i;

function isCodeExpression(line) {
  const match = CODE_ASSIGNMENT.exec(line);
  if (!match) return false;
  const value = match[1];
  // A call, a member access, or a plain word with no digits: an identifier, not material.
  return /[(.]/.test(line.slice(match.index + match[0].length - 1, match.index + match[0].length)) || !/\d/.test(value);
}

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Dotfiles are skipped except the ones that matter here: workflow definitions and
    // anything env-shaped, which must be inspected precisely because it is hidden.
    if (entry.name.startsWith('.') && entry.name !== '.github' && !entry.name.startsWith('.env')) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    if (SKIP_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    yield full;
  }
}

function stagedFiles() {
  const output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { cwd: ROOT, encoding: 'utf8' });
  return output.split('\n').map(line => line.trim()).filter(Boolean).map(file => path.join(ROOT, file));
}

/** An env file that is not the example is a finding in itself. */
function isCommittedEnvFile(file) {
  const name = path.basename(file);
  return name === '.env' || (name.startsWith('.env.') && !name.endsWith('.example'));
}

export async function scanFile(file) {
  const findings = [];
  let info;
  try {
    info = await stat(file);
  } catch {
    return findings;
  }
  if (!info.isFile() || info.size > MAX_BYTES) return findings;
  if (isCommittedEnvFile(file)) {
    findings.push({ file, line: 0, rule: 'committed-env-file', detail: 'An environment file is committed. Only .env.example belongs in the repository.' });
  }
  let body;
  try {
    body = await readFile(file, 'utf8');
  } catch {
    return findings;
  }
  if (body.includes('\u0000')) return findings; // binary file
  const documentation = DOCUMENTATION.test(file);
  const lines = body.split('\n');
  lines.forEach((line, index) => {
    if (line.length > MAX_LINE) return;
    const found = detectSecretShape(line);
    if (!found) return;
    if (found.id === 'assignment-to-secret' && isCodeExpression(line)) return;
    // An exemption must be written down next to the thing it exempts. Security code
    // and its tests necessarily contain credential *shapes*; a path-based skip would
    // also hide real material in those same files, so each line states its reason.
    if (ALLOW_MARKER.test(line) || (index > 0 && ALLOW_MARKER.test(lines[index - 1]))) {
      findings.push({ file, line: index + 1, rule: found.id, allowed: true, detail: 'exempted in place' });
      return;
    }
    // Documentation legitimately shows credential *shapes* in fenced examples; the
    // detector already exempts placeholders, so what remains in prose is worth a
    // warning rather than a hard failure.
    findings.push({ file, line: index + 1, rule: found.id, warning: documentation, detail: documentation ? 'Credential shape in documentation. Replace it with a placeholder.' : 'Credential material must not be committed.' });
  });
  return findings;
}

export async function scan(targets) {
  const findings = [];
  for (const target of targets) findings.push(...await scanFile(target));
  return findings;
}

/**
 * The paths git is told to ignore, among the ones given.
 *
 * The invariant is that no secret may be *committed*, and a walk of the working tree
 * also sees what an operator's own runs leave behind. Running the plane once writes a
 * plaintext Ed25519 signing key to `control-plane/data/keystore.json` — real key
 * material, correctly ignored, and impossible to commit. Reporting it as a violation
 * teaches people that a red scan is normal, which is the state in which a real finding
 * goes unread.
 *
 * It is not silently dropped either: an ignored file that carries credential material is
 * still worth a line, because "ignored" is a claim about `.gitignore` today and the
 * material is real. So it is reported as *held*, separately from what is committable,
 * and it does not fail the run.
 */
function ignoredPaths(files) {
  if (!files.length) return new Set();
  try {
    const output = execFileSync('git', ['check-ignore', '--stdin'], { cwd: ROOT, encoding: 'utf8', input: files.join('\n') });
    return new Set(output.split('\n').filter(Boolean).map(file => path.resolve(ROOT, file)));
  } catch (error) {
    // `git check-ignore` exits 1 when nothing matched, which is not an error here.
    if (error.status === 1) return new Set(String(error.stdout ?? '').split('\n').filter(Boolean).map(file => path.resolve(ROOT, file)));
    return new Set();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let targets;
  // A staged file is by definition on its way into history: nothing there is exempt.
  let ignored = new Set();
  if (args.includes('--staged')) targets = stagedFiles();
  else if (args.length) targets = args.map(file => path.resolve(file));
  else {
    targets = [];
    for await (const file of walk(ROOT)) targets.push(file);
  }
  if (!args.includes('--staged')) ignored = ignoredPaths(targets);

  const findings = await scan(targets);
  const held = findings.filter(finding => !finding.allowed && ignored.has(path.resolve(finding.file)));
  const errors = findings.filter(finding => !finding.warning && !finding.allowed && !ignored.has(path.resolve(finding.file)));
  const warnings = findings.filter(finding => finding.warning && !finding.allowed && !ignored.has(path.resolve(finding.file)));
  const allowed = findings.filter(finding => finding.allowed);

  for (const finding of held) console.log(`held  ${path.relative(ROOT, finding.file)}:${finding.line}  ${finding.rule}  git-ignored runtime state: real material, not committable`);
  for (const finding of warnings) console.warn(`warn  ${path.relative(ROOT, finding.file)}:${finding.line}  ${finding.rule}  ${finding.detail}`);
  for (const finding of errors) console.error(`error ${path.relative(ROOT, finding.file)}:${finding.line}  ${finding.rule}  ${finding.detail}`);
  console.log(`scanned ${targets.length} file(s): ${errors.length} finding(s), ${warnings.length} warning(s), ${held.length} held out of source control, ${allowed.length} exempted in place`);
  if (errors.length) {
    console.error('\nA secret must never be committed. Rotate anything that reached the repository, then remove it from the working tree and from history.');
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
