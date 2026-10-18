import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { DatabaseKeyError, EncryptionUnavailableError, openDatabase, resetDatabase } from '../client';

// Native-only pieces (SecureStore, SQLCipher) are mocked: this covers the key logic, not encryption itself.
const mockStore = new Map<string, string>();
const CIPHER = { cipher_version: '4.6.1 community' };
const answer = (sql: string) => (sql === 'PRAGMA cipher_version' ? CIPHER : { 'count(*)': 0 });
const mockSqlite = { execSync: jest.fn(), getFirstSync: jest.fn<unknown, [string]>(answer), closeSync: jest.fn() };

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: jest.fn(() => mockSqlite),
  deleteDatabaseSync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));
const mockDir = { exists: false, delete: jest.fn() };
jest.mock('expo-file-system', () => ({
  Directory: jest.fn(() => mockDir),
  Paths: { document: { uri: 'file:///docs' } },
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('drizzle-orm/expo-sqlite', () => ({ drizzle: jest.fn(() => ({})) }));
jest.mock('drizzle-orm/expo-sqlite/migrator', () => ({ migrate: jest.fn(async () => {}) }));

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockDir.exists = false;
  mockSqlite.getFirstSync.mockImplementation(answer);
});

function expectNothingDestroyed() {
  expect(SQLite.deleteDatabaseSync).not.toHaveBeenCalled();
  expect(SQLite.deleteDatabaseAsync).not.toHaveBeenCalled();
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
}

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
  // Encryption is verified before the file is read.
  expect(mockSqlite.getFirstSync.mock.calls.map(([s]) => s)).toEqual([
    'PRAGMA cipher_version',
    'SELECT count(*) FROM sqlite_master',
    'PRAGMA cipher_version',
    'SELECT count(*) FROM sqlite_master',
  ]);
  expect(mockSqlite.closeSync).not.toHaveBeenCalled();
  expect(migrate).toHaveBeenCalledTimes(2);
  // The real drizzle/migrations.js, with .sql inlined by babel-plugin-inline-import.
  expect(migrate).toHaveBeenCalledWith(
    {},
    expect.objectContaining({
      migrations: {
        m0000: expect.stringContaining('CREATE TABLE `vehicles`'),
        m0001: expect.stringContaining('CREATE TABLE `device_prefs`'),
        m0002: expect.stringContaining('ADD `log_id`'),
      },
    }),
  );
});

function failProbe() {
  mockSqlite.getFirstSync.mockImplementation((sql: string) => {
    if (sql.startsWith('SELECT')) throw new Error('file is not a database');
    return answer(sql);
  });
}

test('no stored key and a failing probe: closes the DB and throws DatabaseKeyError without deleting or storing anything', async () => {
  failProbe();

  await expect(openDatabase()).rejects.toBeInstanceOf(DatabaseKeyError);

  expect(mockSqlite.closeSync).toHaveBeenCalledTimes(1);
  expectNothingDestroyed();
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled(); // an existing file is never paired with a fresh key
  expect(migrate).not.toHaveBeenCalled();
});

test('a stored key and a failing probe is a plain error (data may be intact, so no reset is offered)', async () => {
  mockStore.set('garagem.db.key', 'a'.repeat(64));
  failProbe();

  const err = await openDatabase().catch((e: unknown) => e);

  expect(err).toBeInstanceOf(Error);
  expect(err).not.toBeInstanceOf(DatabaseKeyError);
  expect((err as Error).message).not.toContain('a'.repeat(64));
  expect(mockSqlite.closeSync).toHaveBeenCalledTimes(1);
  expectNothingDestroyed();
  expect(mockStore.get('garagem.db.key')).toBe('a'.repeat(64));
  expect(migrate).not.toHaveBeenCalled();
});

test.each([null, { cipher_version: '' }])(
  'fails closed when SQLCipher is missing (cipher_version %p): no read, no key stored',
  async (cipher) => {
    mockSqlite.getFirstSync.mockImplementation((sql: string) => (sql === 'PRAGMA cipher_version' ? cipher : {}));

    const err = await openDatabase().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(EncryptionUnavailableError);
    expect((err as Error).message).toBe('A criptografia do banco não está disponível nesta versão do app.');
    expect(mockSqlite.getFirstSync).not.toHaveBeenCalledWith('SELECT count(*) FROM sqlite_master');
    expect(mockSqlite.closeSync).toHaveBeenCalledTimes(1);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(migrate).not.toHaveBeenCalled();
    expectNothingDestroyed();
  },
);

test('closes the handle when storing the new key fails', async () => {
  jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('keychain unavailable'));

  await expect(openDatabase()).rejects.toThrow('keychain unavailable');

  expect(mockSqlite.closeSync).toHaveBeenCalledTimes(1);
  expect(migrate).not.toHaveBeenCalled();
  expectNothingDestroyed();
});

test('closes the handle when the migration fails', async () => {
  jest.mocked(migrate).mockRejectedValueOnce(new Error('migration failed'));

  await expect(openDatabase()).rejects.toThrow('migration failed');

  expect(mockSqlite.closeSync).toHaveBeenCalledTimes(1);
  expectNothingDestroyed();
});

describe('resetDatabase', () => {
  test('closes the open handle, then deletes the file and the key', async () => {
    await openDatabase();
    expect(mockStore.has('garagem.db.key')).toBe(true);

    await resetDatabase();

    expect(mockSqlite.closeSync).toHaveBeenCalledTimes(1);
    expect(SQLite.deleteDatabaseSync).toHaveBeenCalledWith('garagem.db');
    expect(mockSqlite.closeSync.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(SQLite.deleteDatabaseSync).mock.invocationCallOrder[0],
    );
    expect(mockStore.has('garagem.db.key')).toBe(false);
    expect(mockDir.delete).not.toHaveBeenCalled();

    mockDir.exists = true;
    await resetDatabase(); // the handle is closed only once
    expect(mockSqlite.closeSync).toHaveBeenCalledTimes(1);
    expect(mockDir.delete).toHaveBeenCalledTimes(1);
  });

  test('a missing file is fine; any other delete failure keeps the key', async () => {
    mockStore.set('garagem.db.key', 'k');
    jest.mocked(SQLite.deleteDatabaseSync).mockImplementationOnce(() => {
      throw new Error("Calling the 'deleteDatabaseSync' function has failed\n→ Caused by: Database 'garagem.db' not found");
    });
    await resetDatabase();
    expect(mockStore.has('garagem.db.key')).toBe(false);

    mockStore.set('garagem.db.key', 'k');
    jest.mocked(SQLite.deleteDatabaseSync).mockImplementationOnce(() => {
      throw new Error('Unable to delete database garagem.db that is currently open');
    });
    await expect(resetDatabase()).rejects.toThrow('currently open');
    expect(mockStore.get('garagem.db.key')).toBe('k');
  });
});
