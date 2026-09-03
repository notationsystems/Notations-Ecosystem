/**
 * Journal record signing and the key lifecycle around it.
 *
 * The hash chain already proves that record N follows record N-1. It does not prove
 * who wrote them: anyone able to write the journal file can rewrite history from any
 * point and recompute every hash. A signature over the record hash closes that gap —
 * rewriting history now requires the signing key, not merely write access to a file.
 *
 * Ed25519 is used through Node's built-in `crypto`: small keys, deterministic
 * signatures, no parameter choices to get wrong.
 *
 * Lifecycle
 *   - one *active* key signs; every key ever active stays in the registry as a
 *     *verification* key, so history signed by a retired key still verifies;
 *   - rotation adds a new active key and retires the previous one at a recorded
 *     journal position. Retirement is enforced, not annotated: a retired key verifies
 *     the records it signed while it was active and nothing after them, and its
 *     private half is dropped from the store. Without both, rotation would move the
 *     signing key without reducing what a stolen copy of the old one is worth — it
 *     could still mint records that verify at the head of the chain;
 *   - the private half is stored wrapped by envelope encryption when a key
 *     encryption key is configured, so a stolen key file is not a signing capability;
 *   - the signature covers the record hash, which already commits to the event and to
 *     the whole preceding chain.
 */

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { CryptoError, open, seal } from './envelope.js';

export const SIGNATURE_ALGORITHM = 'ed25519';
export const KEYSTORE_SCHEMA = 'notations.control-plane.keystore.v1';
export const SIGNING_CONTEXT = 'journal-signing-key';
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/;

const b64 = buffer => Buffer.from(buffer).toString('base64url');

/** The bytes a signature commits to: the domain, the key id, and the record hash. */
export function signingPayload(recordHash, keyId) {
  return Buffer.from(`notations.control-plane.signature.v1|${keyId}|${recordHash}`, 'utf8');
}

export class SigningKey {
  constructor({ keyId, privateKey, publicKey }) {
    this.keyId = keyId;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
  }

  static generate(keyId) {
    if (!KEY_ID.test(keyId)) throw new CryptoError(`Invalid signing key id ${keyId}.`);
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    return new SigningKey({ keyId, privateKey, publicKey });
  }

  sign(recordHash) {
    return b64(cryptoSign(null, signingPayload(recordHash, this.keyId), this.privateKey));
  }

  publicKeyBase64() {
    return this.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  }

  privateKeyPem() {
    return this.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  }
}

export function verifySignature(recordHash, signature, publicKeyBase64, keyId) {
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), type: 'spki', format: 'der' });
    return cryptoVerify(null, signingPayload(recordHash, keyId), publicKey, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

/**
 * The set of keys a control plane can sign and verify with.
 *
 * On disk the store holds public keys in the clear and the active private key either
 * wrapped (when a key encryption key is configured) or, for local development only,
 * as PEM with a recorded warning.
 */
export class KeyStore {
  constructor({ filePath, keys = [], activeKeyId = null, kek = null }) {
    this.filePath = resolve(filePath);
    this.keys = keys;
    this.activeKeyId = activeKeyId;
    this.kek = kek;
    this.signingKey = null;
    this.warnings = [];
  }

  /** Verification material for every key, retired ones included. */
  publicKeys() {
    return new Map(this.keys.map(key => [key.keyId, key.publicKey]));
  }

  get active() {
    return this.keys.find(key => key.keyId === this.activeKeyId) ?? null;
  }

  canSign() {
    return this.signingKey !== null;
  }

  sign(recordHash) {
    if (!this.signingKey) throw new CryptoError('No active signing key is loaded.');
    return { keyId: this.signingKey.keyId, alg: SIGNATURE_ALGORITHM, sig: this.signingKey.sign(recordHash) };
  }

  /**
   * Verify a record's signature block against the registry.
   *
   * `index` is the record's zero-based position in the journal. When it is given, a
   * key that has been retired is held to the position at which it was retired: it
   * verifies the history it actually signed and refuses anything appended after.
   * A key retired before that position was recorded — a store written by an older
   * rotation — cannot be bounded, and `retirementBounds()` reports that rather than
   * pretending the bound exists.
   *
   * @returns {{ok: true} | {ok: false, reason: string}}
   */
  verify(recordHash, signature, { index = null } = {}) {
    if (!signature || typeof signature !== 'object') return { ok: false, reason: 'record has no signature' };
    if (signature.alg !== SIGNATURE_ALGORITHM) return { ok: false, reason: `unsupported signature algorithm ${signature.alg}` };
    const key = this.keys.find(candidate => candidate.keyId === signature.keyId);
    if (!key) return { ok: false, reason: `signature names unknown key ${signature.keyId}` };
    if (typeof signature.sig !== 'string') return { ok: false, reason: 'signature is malformed' };
    if (index !== null && Number.isInteger(key.retiredAtRecord) && index >= key.retiredAtRecord) {
      return { ok: false, reason: `is signed by key ${signature.keyId}, which was retired at record ${key.retiredAtRecord}` };
    }
    if (!verifySignature(recordHash, signature.sig, key.publicKey, signature.keyId)) return { ok: false, reason: `signature does not verify under key ${signature.keyId}` };
    return { ok: true };
  }

  /** Keys retired without a recorded position, whose authority cannot be bounded. */
  retirementBounds() {
    return this.keys.filter(key => key.retiredAt && !Number.isInteger(key.retiredAtRecord)).map(key => key.keyId);
  }

  toJSON() {
    return {
      schema: KEYSTORE_SCHEMA,
      activeKeyId: this.activeKeyId,
      keys: this.keys.map(key => ({
        keyId: key.keyId,
        alg: SIGNATURE_ALGORITHM,
        publicKey: key.publicKey,
        createdAt: key.createdAt,
        retiredAt: key.retiredAt ?? null,
        retiredAtRecord: Number.isInteger(key.retiredAtRecord) ? key.retiredAtRecord : null,
        activeFromRecord: key.activeFromRecord ?? 0,
        privateKey: key.privateKey ?? null,
      })),
    };
  }

  async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(this.toJSON(), null, 2)}\n`, { mode: 0o600 });
    await chmod(this.filePath, 0o600).catch(() => undefined);
  }

  /** Public verification material only: safe to publish, and what a verifier needs. */
  describe() {
    return {
      algorithm: SIGNATURE_ALGORITHM,
      activeKeyId: this.activeKeyId,
      canSign: this.canSign(),
      privateKeyProtection: this.kek ? 'envelope-encrypted' : this.signingKey ? 'plaintext-on-disk' : 'absent',
      keys: this.keys.map(key => ({ keyId: key.keyId, createdAt: key.createdAt, retiredAt: key.retiredAt ?? null, retiredAtRecord: Number.isInteger(key.retiredAtRecord) ? key.retiredAtRecord : null, activeFromRecord: key.activeFromRecord ?? 0, publicKey: key.publicKey })),
      unboundedRetiredKeys: this.retirementBounds(),
    };
  }

  /**
   * Load a key store, creating one on first use when `create` is set.
   * @param {object} options
   * @param {string} options.filePath
   * @param {import('./envelope.js').KeyEncryptionKey|null} [options.kek]
   * @param {boolean} [options.create] generate an active key if the store is absent
   */
  static async load({ filePath, kek = null, create = false, now = () => new Date().toISOString() }) {
    const store = new KeyStore({ filePath, kek });
    let parsed = null;
    try {
      parsed = JSON.parse(await readFile(store.filePath, 'utf8'));
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw new CryptoError(`Key store ${filePath} could not be read: ${error?.message ?? error}`);
    }
    if (parsed) {
      if (parsed.schema !== KEYSTORE_SCHEMA) throw new CryptoError(`Key store ${filePath} has unsupported schema ${parsed.schema}.`);
      store.keys = parsed.keys ?? [];
      store.activeKeyId = parsed.activeKeyId ?? null;
      const active = store.active;
      if (active?.privateKey) {
        store.signingKey = loadPrivate(active, kek, store);
      } else if (active) {
        store.warnings.push(`active key ${active.keyId} has no private half in this store; the control plane can verify but not sign.`);
      }
      return store;
    }
    if (!create) return store;
    const generated = SigningKey.generate(`k-${Date.now().toString(36)}`);
    store.keys = [{
      keyId: generated.keyId,
      alg: SIGNATURE_ALGORITHM,
      publicKey: generated.publicKeyBase64(),
      createdAt: now(),
      retiredAt: null,
      activeFromRecord: 0,
      privateKey: wrapPrivate(generated, kek, store),
    }];
    store.activeKeyId = generated.keyId;
    store.signingKey = generated;
    await store.save();
    return store;
  }

  /**
   * Rotate: generate a new active key and retire the current one at `atRecord`, the
   * journal length at the moment of rotation. Records the retired key signed before
   * that point keep verifying; anything it signs afterwards does not, and its private
   * half no longer exists in the store.
   */
  async rotate({ atRecord = 0, now = () => new Date().toISOString() } = {}) {
    if (!Number.isInteger(atRecord) || atRecord < 0) throw new CryptoError('Rotation needs the journal length it happens at, so the retired key can be held to it.');
    const generated = SigningKey.generate(`k-${Date.now().toString(36)}`);
    const previous = this.active;
    if (previous) {
      previous.retiredAt = now();
      previous.retiredAtRecord = atRecord;
      // Retirement removes the capability, not only the label. What stays behind is
      // the public half, which is all a verifier of past records needs.
      previous.privateKey = null;
    }
    this.keys.push({
      keyId: generated.keyId,
      alg: SIGNATURE_ALGORITHM,
      publicKey: generated.publicKeyBase64(),
      createdAt: now(),
      retiredAt: null,
      activeFromRecord: atRecord,
      privateKey: wrapPrivate(generated, this.kek, this),
    });
    this.activeKeyId = generated.keyId;
    this.signingKey = generated;
    await this.save();
    return { retired: previous?.keyId ?? null, active: generated.keyId };
  }
}

function wrapPrivate(signingKey, kek, store) {
  const pem = signingKey.privateKeyPem();
  if (!kek) {
    store.warnings.push('CONTROL_PLANE_KEK is not set: the journal signing key is stored in plaintext. Set a key encryption key before any deployment that is not a developer laptop.');
    return { protection: 'plaintext', pem };
  }
  return { protection: 'envelope', sealed: seal(kek, pem, SIGNING_CONTEXT) };
}

function loadPrivate(entry, kek, store) {
  const stored = entry.privateKey;
  if (stored.protection === 'plaintext') {
    store.warnings.push(`signing key ${entry.keyId} is stored in plaintext on disk.`);
    return new SigningKey({ keyId: entry.keyId, privateKey: createPrivateKey(stored.pem), publicKey: createPublicKey(createPrivateKey(stored.pem)) });
  }
  if (stored.protection === 'envelope') {
    if (!kek) throw new CryptoError(`Signing key ${entry.keyId} is envelope-encrypted but no key encryption key is configured. Set CONTROL_PLANE_KEK.`);
    const pem = open([kek], stored.sealed, SIGNING_CONTEXT).toString('utf8');
    const privateKey = createPrivateKey(pem);
    return new SigningKey({ keyId: entry.keyId, privateKey, publicKey: createPublicKey(privateKey) });
  }
  throw new CryptoError(`Signing key ${entry.keyId} has unknown protection ${stored.protection}.`);
}
