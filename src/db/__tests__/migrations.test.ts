import { drizzle } from 'drizzle-orm/sql-js';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import initSqlJs from 'sql.js';
import migrations from '../../../drizzle/migrations';
import {
  itemsQuery,
  readingsQuery,
  removeMaintenance,
  selectedVehicleIdQuery,
  selectVehicle,
  vehiclesQuery,
} from '../repo';
import * as schema from '../schema';

// The app's own migrator and bundle, run on sql.js: the migrator only uses drizzle's sync SQLite
// dialect, which both drivers share, hence the cast.
const appMigrate = (db: unknown, entries: typeof migrations.journal.entries) =>
  migrate(db as Parameters<typeof migrate>[0], {
    ...migrations,
    journal: { ...migrations.journal, entries },
  });

const T = "'2026-10-01T00:00:00.000Z'";

test('the latest migration applies on top of the previous ones; data from before it keeps working', async () => {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // An installed app: every migration but the latest, plus data written by that version: a car
  // started at 40.000 km whose oil log moved the baseline (no marco zero kept, reading not linked).
  await appMigrate(db, migrations.journal.entries.slice(0, -1));
  sqlite.run(`
    INSERT INTO vehicles (id, nickname, monthly_km_estimate, created_at, updated_at)
      VALUES ('v1', 'Carro', 1000, ${T}, ${T});
    INSERT INTO odometer_readings (id, vehicle_id, km, read_at, source, created_at, updated_at) VALUES
      ('r1', 'v1', 40000, '2026-09-01', 'onboarding', ${T}, ${T}),
      ('r2', 'v1', 41000, '2026-10-01', 'log', ${T}, ${T});
    INSERT INTO maintenance_items (id, vehicle_id, name, interval_km, baseline_km, baseline_date, created_at, updated_at)
      VALUES ('i1', 'v1', 'Óleo', 10000, 41000, '2026-10-01', ${T}, ${T});
    INSERT INTO maintenance_logs (id, vehicle_id, item_id, performed_at, km, created_at, updated_at)
      VALUES ('l1', 'v1', 'i1', '2026-10-01', 41000, ${T}, ${T});
  `);

  await appMigrate(db, migrations.journal.entries);

  expect(
    vehiclesQuery(db)
      .all()
      .map((v) => v.id),
  ).toEqual(['v1']);
  expect(selectedVehicleIdQuery(db).all()).toEqual([]);
  await selectVehicle(db, 'v1');
  expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: 'v1' }]);

  // Removing the old log finds its reading by value and falls back to the onboarding reading.
  await removeMaintenance(db, 'l1');
  expect(readingsQuery(db, 'v1').all()).toEqual([{ km: 40000, readAt: '2026-09-01' }]);
  expect(itemsQuery(db, 'v1').all()).toEqual([
    expect.objectContaining({ baselineKm: 40000, baselineDate: '2026-09-01', startKm: null }),
  ]);
});
