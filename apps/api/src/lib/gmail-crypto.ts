import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Refresh tokens live in Postgres for the lifetime of the Gmail connection.
 * Anyone with DB read access should NOT be able to impersonate a customer's
 * mailbox, so we wrap them in AES-256-GCM with a workspace-independent key
 * held only in the app process env.
 *
 * Storage format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */

const KEY_ENV = 'TELECOMM_ENCRYPTION_KEY';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard

function key(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(
      `${KEY_ENV} is not set. Generate one with: openssl rand -hex 32 — ` +
        'then set it as an env var on the API service. Without it, Gmail ' +
        'refresh tokens cannot be stored or decrypted.',
    );
  }
  const buf = Buffer.from(raw.trim(), 'hex');
  if (buf.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to 32 bytes (64 hex chars). Got ${buf.length} bytes.`);
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Malformed ciphertext');
  const [ivHex, tagHex, ctHex] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return dec.toString('utf8');
}
