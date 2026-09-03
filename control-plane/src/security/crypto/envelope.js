/**
 * Application-layer envelope encryption.
 *
 * Used where infrastructure encryption is not sufficient because the threat includes
 * an attacker who can read the filesystem: the control plane's journal signing key is
 * stored wrapped by this module, so a stolen key file is not a signing capability.
 *
 *   plaintext --AES-256-GCM(DEK)--> ciphertext
 *   DEK       --AES-256-GCM(KEK)--> wrapped DEK
 *
 * No primitive is invented here. AES-256-GCM is used through Node's built-in
 * `crypto`, a fresh 96-bit nonce is drawn for every single encryption (never derived,
 * never reused), and the ciphertext is bound to its context with additional
 * authenticated data so a wrapped value cannot be moved from one field or one purpose
 * to another and still verify.
 *
 * Sealed format (JSON, versioned):
 *   { v: 1, alg: 'AES-256-GCM', kekId, aad, dek: {n, ct, tag}, data: {n, ct, tag} }
 * Every field is base64url. `v` and `alg` are covered by the AAD of both layers, so a
 * downgrade to a weaker declared algorithm does not verify.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const SEALED_VERSION = 1;
export const ALGORITHM = 'AES-256-GCM';
const NODE_ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** scrypt parameters for deriving a KEK from a passphrase. Interactive-grade. */
export const SCRYPT = Object.freeze({ N: 2 ** 15, r: 8, p: 1, keylen: KEY_BYTES, maxmem: 96 * 1024 * 1024 });

const b64 = buffer => Buffer.from(buffer).toString('base64url');
const unb64 = text => Buffer.from(text, 'base64url');

export class CryptoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CryptoError';
  }
}

/** A key-encryption key: 32 bytes plus the id recorded in every value it wraps. */
export class KeyEncryptionKey {
  constructor(id, material) {
    if (!id || typeof id !== 'string') throw new CryptoError('A key encryption key needs an id.');
    const key = Buffer.from(material);
    if (key.length !== KEY_BYTES) throw new CryptoError(`A key encryption key must be ${KEY_BYTES} bytes, received ${key.length}.`);
    this.id = id;
    this.material = key;
    Object.freeze(this);
  }

  /** From base64 or base64url material, e.g. an environment variable. */
  static fromBase64(id, encoded) {
    const material = Buffer.from(String(encoded).trim(), 'base64');
    return new KeyEncryptionKey(id, material);
  }

  /** From a passphrase. The salt must be stored alongside the sealed value's owner. */
  static fromPassphrase(id, passphrase, salt) {
    const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt), 'utf8');
    if (saltBuffer.length < 16) throw new CryptoError('A passphrase-derived key needs a salt of at least 16 bytes.');
    return new KeyEncryptionKey(id, scryptSync(String(passphrase), saltBuffer, SCRYPT.keylen, SCRYPT));
  }

  static generate(id) {
    return new KeyEncryptionKey(id, randomBytes(KEY_BYTES));
  }
}

function encryptWith(key, plaintext, aad) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(NODE_ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { n: b64(nonce), ct: b64(ciphertext), tag: b64(cipher.getAuthTag()) };
}

function decryptWith(key, part, aad) {
  const nonce = unb64(part.n);
  const tag = unb64(part.tag);
  if (nonce.length !== NONCE_BYTES) throw new CryptoError('Sealed value has a malformed nonce.');
  if (tag.length !== TAG_BYTES) throw new CryptoError('Sealed value has a malformed authentication tag.');
  const decipher = createDecipheriv(NODE_ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(unb64(part.ct)), decipher.final()]);
  } catch {
    throw new CryptoError('Sealed value failed authentication: it was produced with a different key, context, or has been modified.');
  }
}

/**
 * Encrypt `plaintext` under a fresh data key, wrap that key with the KEK, and bind
 * both layers to `context`.
 *
 * @param {KeyEncryptionKey} kek
 * @param {Buffer|string} plaintext
 * @param {string} context a stable purpose string, e.g. 'journal-signing-key'
 */
export function seal(kek, plaintext, context) {
  if (!(kek instanceof KeyEncryptionKey)) throw new CryptoError('seal requires a KeyEncryptionKey.');
  if (typeof context !== 'string' || !context) throw new CryptoError('seal requires a non-empty context.');
  const aad = `${SEALED_VERSION}|${ALGORITHM}|${kek.id}|${context}`;
  const dek = randomBytes(KEY_BYTES);
  try {
    const data = encryptWith(dek, Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8'), aad);
    const wrapped = encryptWith(kek.material, dek, aad);
    return { v: SEALED_VERSION, alg: ALGORITHM, kekId: kek.id, aad: context, dek: wrapped, data };
  } finally {
    dek.fill(0);
  }
}

/**
 * Unwrap and decrypt. Fails closed on version or algorithm mismatch, unknown key id,
 * a changed context, or any modification to either layer.
 *
 * @param {KeyEncryptionKey|KeyEncryptionKey[]} keys the active key, or a set including retired keys
 */
export function open(keys, sealed, context) {
  const candidates = Array.isArray(keys) ? keys : [keys];
  if (!sealed || typeof sealed !== 'object') throw new CryptoError('Sealed value is not an object.');
  if (sealed.v !== SEALED_VERSION) throw new CryptoError(`Unsupported sealed version ${sealed.v}.`);
  if (sealed.alg !== ALGORITHM) throw new CryptoError(`Unsupported algorithm ${sealed.alg}.`);
  if (sealed.aad !== context) throw new CryptoError(`Sealed value belongs to context ${sealed.aad}, not ${context}.`);
  const kek = candidates.find(candidate => candidate.id === sealed.kekId);
  if (!kek) throw new CryptoError(`No key encryption key with id ${sealed.kekId} is available.`);
  const aad = `${sealed.v}|${sealed.alg}|${sealed.kekId}|${sealed.aad}`;
  const dek = decryptWith(kek.material, sealed.dek, aad);
  try {
    if (dek.length !== KEY_BYTES) throw new CryptoError('Unwrapped data key has the wrong length.');
    return decryptWith(dek, sealed.data, aad);
  } finally {
    dek.fill(0);
  }
}

/**
 * Re-wrap a sealed value under a new KEK without exposing the plaintext to the
 * caller. This is the key-rotation primitive: rotate the wrapping key on a schedule
 * while the data keys and the ciphertext stay put.
 */
export function rewrap(oldKeys, sealed, newKek, context) {
  const plaintext = open(oldKeys, sealed, context);
  try {
    return seal(newKek, plaintext, context);
  } finally {
    plaintext.fill(0);
  }
}

/** Constant-time equality for two secrets of the same purpose. */
export function secretsEqual(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
