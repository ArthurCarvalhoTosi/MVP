import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/sql-js/migrator';
import initSqlJs from 'sql.js';
import type { Db } from '../client';
import * as schema from '../schema';

// Outside __tests__ because jest runs every file there as a suite.
const sqlJs = initSqlJs();

// In-memory DB with the real generated migrations (plain SQLite: no SQLCipher in tests).
export async function createTestDb(): Promise<Db> {
  const SQL = await sqlJs;
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' }); // jest runs from the package root
  return db;
}
