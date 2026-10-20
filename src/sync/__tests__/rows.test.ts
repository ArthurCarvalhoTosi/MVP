import { AESEncryptionKey } from 'expo-crypto';
import type { SyncRow } from '@/db/sync';
import { fromByteaHex, isoMs, toByteaHex } from '../remote';
import { openRow, sealRow } from '../rows';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());

const ID = '0199f0a0-0000-7000-8000-000000000001';
const row: SyncRow = {
  table: 'vehicles',
  id: ID,
  updatedAt: '2026-10-01T09:00:00.000Z',
  deletedAt: null,
  row: {
    id: ID,
    nickname: 'Fusca — ação 🚗',
    updatedAt: '2026-10-01T09:00:00.000Z',
    deletedAt: null,
  },
};

let key: AESEncryptionKey;
beforeEach(async () => {
  key = await AESEncryptionKey.generate();
});

test('seal then open gives the row back, accents and emoji included', async () => {
  const sealed = await sealRow(key, row);
  expect(sealed).toMatchObject({ table: 'vehicles', id: ID, keyVersion: 1, deletedAt: null });
  expect(sealed.nonce).toHaveLength(12);
  expect(await openRow(key, sealed)).toEqual(row);
});

test('the server cannot pass a row off as another table or id', async () => {
  const sealed = await sealRow(key, row);
  expect(await openRow(key, { ...sealed, table: 'maintenance_items' })).toBeNull();
  expect(await openRow(key, { ...sealed, id: '0199f0a0-0000-7000-8000-000000000002' })).toBeNull();
});

test('a row whose readable time disagrees with the sealed one is refused', async () => {
  const sealed = await sealRow(key, row);
  expect(await openRow(key, { ...sealed, updatedAt: '2030-01-01T00:00:00.000Z' })).toBeNull();
});

test('unknown tables (a newer app) are ignored', async () => {
  const sealed = await sealRow(key, row);
  expect(await openRow(key, { ...sealed, table: 'attachments' })).toBeNull();
});

test('bytea hex round-trips and matches PostgREST', () => {
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  expect(fromByteaHex(toByteaHex(all))).toEqual(all);
  expect(toByteaHex(Uint8Array.of(0, 15, 255))).toBe('\\x000fff');
  expect(fromByteaHex('\\x000FFF')).toEqual(Uint8Array.of(0, 15, 255));
  expect(() => fromByteaHex('000fff')).toThrow();
  expect(() => fromByteaHex('\\x0')).toThrow();
});

test('server timestamps read back in the app format', () => {
  expect(isoMs('2026-10-20T20:01:17.886+00:00')).toBe('2026-10-20T20:01:17.886Z');
  expect(isoMs('2026-10-20 20:01:17.886+00')).toBe('2026-10-20T20:01:17.886Z');
  expect(isoMs('2026-10-20T17:01:17.8+03:00')).toBe('2026-10-20T14:01:17.800Z');
});
