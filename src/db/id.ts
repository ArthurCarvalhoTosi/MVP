import { getRandomBytes } from 'expo-crypto';

// RFC 9562 UUIDv7: 48-bit unix ms timestamp, then random bits.
// shortcut: ids created in the same ms are not ordered among themselves; add a counter if sync ever needs strict order.
export function uuidv7(): string {
  const b = getRandomBytes(16);
  const ms = Date.now();
  const hi = Math.floor(ms / 2 ** 16); // bitwise ops are 32-bit, so split the 48-bit timestamp
  b[0] = hi >>> 24;
  b[1] = hi >>> 16;
  b[2] = hi >>> 8;
  b[3] = hi;
  b[4] = ms >>> 8;
  b[5] = ms;
  b[6] = 0x70 | (b[6] & 0x0f);
  b[8] = 0x80 | (b[8] & 0x3f);
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
