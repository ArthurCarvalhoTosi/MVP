// Envelope encryption for each user's data key (DEK). See section 8.3 of
// decisoes_projeto_manutencao_veicular.md.
//
// The KEK never reaches the database: it lives in the Edge Function secret KEKS, a JSON map
// of version -> base64 of 32 random bytes. The highest version wraps new keys; older ones
// stay to unwrap keys made before a rotation.

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

export interface Keks {
  currentVersion: number;
  byVersion: Map<number, CryptoKey>;
}

export async function loadKeks(json: string | undefined): Promise<Keks> {
  if (!json) throw new Error('KEKS secret is not set');
  const raw: unknown = JSON.parse(json);
  if (typeof raw !== 'object' || raw === null) throw new Error('KEKS must be a JSON object');

  const byVersion = new Map<number, CryptoKey>();
  for (const [version, value] of Object.entries(raw)) {
    const n = Number(version);
    if (!Number.isInteger(n) || n < 1) throw new Error(`KEKS version ${version} is invalid`);
    const bytes = fromBase64(String(value));
    if (bytes.length !== KEY_BYTES) throw new Error(`KEKS version ${version} is not 32 bytes`);
    byVersion.set(
      n,
      await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']),
    );
  }
  if (byVersion.size === 0) throw new Error('KEKS has no keys');
  return { currentVersion: Math.max(...byVersion.keys()), byVersion };
}

export function generateDek(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

// The user id is bound as associated data, so a wrapped key copied onto another user's row
// fails to unwrap instead of handing that user someone else's data.
function aad(userId: string) {
  return new TextEncoder().encode(`garagem/user-key/v1:${userId}`);
}

// nonce (12 bytes) || ciphertext + GCM tag
export async function wrapDek(
  dek: Uint8Array<ArrayBuffer>,
  kek: CryptoKey,
  userId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad(userId) },
      kek,
      dek,
    ),
  );
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(nonce);
  out.set(sealed, NONCE_BYTES);
  return out;
}

export async function unwrapDek(
  wrapped: Uint8Array<ArrayBuffer>,
  kek: CryptoKey,
  userId: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const dek = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: wrapped.subarray(0, NONCE_BYTES), additionalData: aad(userId) },
      kek,
      wrapped.subarray(NONCE_BYTES),
    ),
  );
  if (dek.length !== KEY_BYTES) throw new Error('unwrapped key has the wrong size');
  return dek;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// PostgREST reads and writes bytea as "\x" followed by hex.
export function toByteaHex(bytes: Uint8Array): string {
  return '\\x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromByteaHex(s: string): Uint8Array<ArrayBuffer> {
  if (!/^\\x([0-9a-f]{2})*$/i.test(s)) throw new Error('not a bytea hex string');
  const hex = s.slice(2);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
