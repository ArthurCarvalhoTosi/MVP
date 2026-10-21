import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { getRandomBytes } from 'expo-crypto';
import { Directory, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseSync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import migrations from '../../drizzle/migrations';
import * as schema from './schema';

// Any sync SQLite drizzle instance with this schema (expo-sqlite in the app, sql.js in tests).
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

/** No stored key, and the existing file can't be read without the original one (e.g. iOS restore). */
export class DatabaseKeyError extends Error {}

export class EncryptionUnavailableError extends Error {
  constructor() {
    super('A criptografia do banco não está disponível nesta versão do app.');
  }
}

const DB_NAME = 'garagem.db';
const KEY_NAME = 'garagem.db.key';

let openHandle: SQLiteDatabase | undefined;

export async function openDatabase(): Promise<Db> {
  const stored = await SecureStore.getItemAsync(KEY_NAME);
  const key =
    stored ?? Array.from(getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');

  const sqlite = openDatabaseSync(DB_NAME, { enableChangeListener: true });
  try {
    unlock(sqlite, key, stored === null);

    // Persist a new key only after it opened the file, so an existing database is never
    // paired with a fresh key (e.g. keychain not restored after a device migration).
    if (stored === null) {
      await SecureStore.setItemAsync(KEY_NAME, key, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    }

    const db = drizzle(sqlite, { schema });
    await migrate(db, migrations);
    openHandle = sqlite;
    return db;
  } catch (e) {
    // Never delete or recreate the file here: that would destroy the user's data.
    sqlite.closeSync();
    throw e;
  }
}

function unlock(sqlite: SQLiteDatabase, key: string, keyIsNew: boolean) {
  try {
    // Raw key ("x'..'") skips SQLCipher's PBKDF2; it must be the first statement on the connection.
    sqlite.execSync(`PRAGMA key = "x'${key}'"`);
    // Plain SQLite ignores PRAGMA key silently, so Expo Go or a build without SQLCipher would store
    // data unencrypted. Checked before the probe so an encrypted file there isn't taken for a key error.
    const cipher = sqlite.getFirstSync<{ cipher_version?: string }>('PRAGMA cipher_version');
    if (!cipher?.cipher_version) throw new EncryptionUnavailableError();
    sqlite.execSync('PRAGMA foreign_keys = ON');
    // A wrong key only surfaces when the file is first read.
    sqlite.getFirstSync('SELECT count(*) FROM sqlite_master');
  } catch (e) {
    if (e instanceof EncryptionUnavailableError) throw e;
    // The original error is dropped on purpose: it could echo the PRAGMA key statement.
    // Only a missing key means the file can never be read (and may be reset); with a stored key the
    // failure may be transient (I/O, busy) and the data intact.
    throw keyIsNew
      ? new DatabaseKeyError('Database key missing')
      : new Error('Database could not be read');
  }
}

/**
 * Deletes the database file and its key. Only for a file that can never be opened again (iOS backs
 * the file up to iCloud but the key is device-only, so a restored iPhone can't read it).
 * Destroys every record: callers must get the user's explicit confirmation first.
 */
export async function resetDatabase(): Promise<void> {
  openHandle?.closeSync();
  openHandle = undefined;
  try {
    deleteDatabaseSync(DB_NAME);
  } catch (e) {
    // No file is fine; any other failure (e.g. still open) must surface.
    if (!(e instanceof Error && /not found/i.test(e.message))) throw e;
  }
  await SecureStore.deleteItemAsync(KEY_NAME);
  // The cloud data key src/account stores; the session went with the database file.
  await SecureStore.deleteItemAsync('garagem.cloud.dek');
  // Same folder src/attachments writes to. Files stay encrypted, but they are still the user's data.
  try {
    const dir = new Directory(Paths.document, 'attachments');
    if (dir.exists) dir.delete();
  } catch {
    // Best effort: leftovers are unreadable without the photo key, which is also device-only.
  }
}
