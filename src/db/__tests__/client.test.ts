import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { DatabaseKeyError, openDatabase } from '../client';

// Native-only pieces (SecureStore, SQLCipher) are mocked: this covers the key logic, not encryption itself.
const mockStore = new Map<string, string>();
const mockSqlite = { execSync: jest.fn(), getFirstSync: jest.fn(), closeSync: jest.fn() };

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => mockSqlite),
  deleteDatabaseSync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: jest.fn(() => ({})) }));
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({ migrate: jest.fn(async () => {}) }));

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

test('generates the key once, stores it device-only, and sends it first as a raw key', async () => {
  await openDatabase();
  await openDatabase();

  expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1);
  const key = mockStore.get('garagem.db.key')!;
  expect(key).toMatch(/^[0-9a-f]{64}$/);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('garagem.db.key', key, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  expect(SQLite.openDatabaseSync).toHaveBeenCalledWith('garagem.db', { enableChangeListener: true });
  expect(mockSqlite.execSync.mock.calls.map(([s]) => s)).toEqual([
    `PRAGMA key = "x'${key}'"`,
    'PRAGMA foreign_keys = ON',
    `PRAGMA key = "x'${key}'"`,
    'PRAGMA foreign_keys = ON',
  ]);
  expect(migrate).toHaveBeenCalledTimes(2);
  // The real drizzle/migrations.js, with .sql inlined by babel-plugin-inline-import.
  expect(migrate).toHaveBeenCalledWith(
    {},
    expect.objectContaining({ migrations: { m0000: expect.stringContaining('CREATE TABLE `vehicles`') } }),
  );
});

test('a failing probe closes the DB and throws DatabaseKeyError without deleting or storing anything', async () => {
  mockSqlite.getFirstSync.mockImplementationOnce(() => {
    throw new Error('file is not a database');
  });

  await expect(openDatabase()).rejects.toBeInstanceOf(DatabaseKeyError);

  expect(mockSqlite.closeSync).toHaveBeenCalled();
  expect(SQLite.deleteDatabaseSync).not.toHaveBeenCalled();
  expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); // an existing file is never paired with a fresh key
  expect(migrate).not.toHaveBeenCalled();
});
