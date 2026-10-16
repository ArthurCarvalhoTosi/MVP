import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import initSqlJs from 'sql.js';
import migrations from '../../../drizzle/migrations';
import { selectedVehicleIdQuery, selectVehicle, vehiclesQuery } from '../repo';
import * as schema from '../schema';

// The app's own migrator and bundle, run on sql.js: the migrator only uses drizzle's sync SQLite
// dialect, which both drivers share, hence the cast.
const appMigrate = (db: unknown, entries: typeof migrations.journal.entries) =>
  migrate(db as Parameters<typeof migrate>[0], { ...migrations, journal: { ...migrations.journal, entries } });

test('the latest migration applies on top of the previous ones; an existing car works with no selection yet', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // An installed app: every migration but the latest, plus data written by that version.
  await appMigrate(db, migrations.journal.entries.slice(0, -1));
  sqlite.run(
    `INSERT INTO vehicles (id, nickname, monthly_km_estimate, created_at, updated_at)
     VALUES ('v1', 'Carro', 1000, '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  );

  await appMigrate(db, migrations.journal.entries);

  expect(vehiclesQuery(db).all().map((v) => v.id)).toEqual(['v1']);
  expect(selectedVehicleIdQuery(db).all()).toEqual([]);
  await selectVehicle(db, 'v1');
  expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: 'v1' }]);
});
