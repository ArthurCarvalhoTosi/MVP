import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseSync } from 'expo-sqlite';
import migrations from '../../drizzle/migrations';
import * as schema from './schema';

// Any sync SQLite drizzle instance with this schema (expo-sqlite in the app, sql.js in tests).
export type Db = BaseSQLiteDatabase<'sync', unknown, typeof schema>;

export class DatabaseKeyError extends Error {}

const KEY_NAME = 'garagem.db.key';

export async function openDatabase(): Promise<Db> {
  const stored = await SecureStore.getItemAsync(KEY_NAME);
  const key = stored ?? Array.from(getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');

  const sqlite = openDatabaseSync('garagem.db', { enableChangeListener: true });
  try {
    // Raw key ("x'..'") skips SQLCipher's PBKDF2; it must be the first statement on the connection.
    sqlite.execSync(`PRAGMA key = "x'${key}'"`);
    sqlite.execSync('PRAGMA foreign_keys = ON');
    // A wrong key only surfaces when the file is first read.
    sqlite.getFirstSync('SELECT count(*) FROM sqlite_master');
  } catch {
    // The original error is dropped on purpose: it could echo the PRAGMA key statement.
    // Never delete or recreate the file here: that would destroy the user's data.
    sqlite.closeSync();
    throw new DatabaseKeyError('Database key missing or wrong');
  }

  // Persist a new key only after it opened the file, so an existing database is never
  // paired with a fresh key (e.g. keychain not restored after a device migration).
  if (stored === null) {
    await SecureStore.setItemAsync(KEY_NAME, key, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }

  const db = drizzle(sqlite, { schema });
  await migrate(db, migrations);
  return db;
}
