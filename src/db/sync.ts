// Local side of the cloud sync: which rows wait to upload, and how rows from the cloud land.
// The device's own bookkeeping (sync_state, sync:* prefs) never leaves the phone.
import { eq, like } from 'drizzle-orm';
import type { Db } from './client';
import {
  devicePrefs,
  maintenanceItems,
  maintenanceLogs,
  odometerReadings,
  syncState,
  vehicleSpecs,
  vehicles,
} from './schema';

// In foreign-key order: parents land before their children inside one transaction.
// shortcut: attachments stay local until slice 4 uploads the photo files; a synced row
// without its file would offer a photo the other phone can't open.
export const SYNC_TABLES = {
  vehicles: { table: vehicles, key: vehicles.id, keyName: 'id' },
  maintenance_items: { table: maintenanceItems, key: maintenanceItems.id, keyName: 'id' },
  maintenance_logs: { table: maintenanceLogs, key: maintenanceLogs.id, keyName: 'id' },
  odometer_readings: { table: odometerReadings, key: odometerReadings.id, keyName: 'id' },
  // One row per car, keyed by the car's id.
  vehicle_specs: { table: vehicleSpecs, key: vehicleSpecs.vehicleId, keyName: 'vehicleId' },
} as const;

export type SyncTable = keyof typeof SYNC_TABLES;
export const SYNC_TABLE_NAMES = Object.keys(SYNC_TABLES) as SyncTable[];

export function isSyncTable(name: string): name is SyncTable {
  return Object.hasOwn(SYNC_TABLES, name);
}

/** A whole local row, as Drizzle reads it (camelCase keys). */
export type SyncRow = {
  table: SyncTable;
  id: string;
  updatedAt: string;
  deletedAt: string | null;
  row: Record<string, unknown>;
};

type RowShape = Record<string, unknown> & { updatedAt: string; deletedAt: string | null };

/** Rows changed since they last went to or came from the cloud, soft-deleted ones included. */
export function pendingRows(db: Db): SyncRow[] {
  const synced = new Map(
    db
      .select()
      .from(syncState)
      .all()
      .map((s) => [`${s.tableName}:${s.rowId}`, s.syncedUpdatedAt]),
  );
  const out: SyncRow[] = [];
  for (const name of SYNC_TABLE_NAMES) {
    const { table, keyName } = SYNC_TABLES[name];
    for (const row of db.select().from(table).all() as RowShape[]) {
      const id = String(row[keyName]);
      if (synced.get(`${name}:${id}`) === row.updatedAt) continue;
      out.push({ table: name, id, updatedAt: row.updatedAt, deletedAt: row.deletedAt, row });
    }
  }
  return out;
}

/**
 * Records rows as uploaded at the updated_at they were read with. An edit made while the upload
 * was in flight has a newer updated_at, so it stays pending.
 */
export function markSynced(db: Db, rows: Pick<SyncRow, 'table' | 'id' | 'updatedAt'>[]): void {
  db.transaction((tx) => {
    for (const r of rows) setSynced(tx, r.table, r.id, r.updatedAt);
  });
}

function setSynced(db: Pick<Db, 'insert'>, table: SyncTable, id: string, updatedAt: string) {
  db.insert(syncState)
    .values({ tableName: table, rowId: id, syncedUpdatedAt: updatedAt })
    .onConflictDoUpdate({
      target: [syncState.tableName, syncState.rowId],
      set: { syncedUpdatedAt: updatedAt },
    })
    .run();
}

/**
 * Lands rows from the cloud. The newer copy of a row wins (last-write-wins on updated_at): an
 * older remote copy is skipped and the local one uploads next. A row that doesn't fit (say,
 * from a newer app version) is skipped on its own instead of failing the whole batch.
 */
export function applyRemote(
  db: Db,
  rows: Omit<SyncRow, 'deletedAt'>[],
): { applied: number; skipped: number } {
  let applied = 0;
  let skipped = 0;
  db.transaction((tx) => {
    for (const name of SYNC_TABLE_NAMES) {
      const { table, key } = SYNC_TABLES[name];
      for (const r of rows.filter((x) => x.table === name)) {
        const local = tx
          .select({ updatedAt: table.updatedAt })
          .from(table)
          .where(eq(key, r.id))
          .get();
        if (local && local.updatedAt > r.updatedAt) continue;
        try {
          // A savepoint: a failing row rolls back alone.
          // The same copy (re-read by the pull overlap) only refreshes the bookkeeping.
          const lands = !local || local.updatedAt < r.updatedAt;
          tx.transaction((sp) => {
            if (lands) {
              sp.insert(table)
                .values(r.row as never)
                .onConflictDoUpdate({ target: key, set: r.row as never })
                .run();
            }
            setSynced(sp, name, r.id, r.updatedAt);
          });
          if (lands) applied++;
        } catch {
          skipped++;
        }
      }
    }
  });
  return { applied, skipped };
}

// --- Device-local sync prefs ---

type SyncPref = 'pullCursor' | 'lastSyncAt';

export function readSyncPref(db: Db, name: SyncPref): string | null {
  return (
    db
      .select({ value: devicePrefs.value })
      .from(devicePrefs)
      .where(eq(devicePrefs.key, `sync:${name}`))
      .get()?.value ?? null
  );
}

export function writeSyncPref(db: Db, name: SyncPref, value: string): void {
  db.insert(devicePrefs)
    .values({ key: `sync:${name}`, value })
    .onConflictDoUpdate({ target: devicePrefs.key, set: { value } })
    .run();
}

/** Forgets what was synced, so another account signing in on this phone starts clean. */
export function clearSyncState(db: Db): void {
  db.transaction((tx) => {
    tx.delete(syncState).run();
    tx.delete(devicePrefs).where(like(devicePrefs.key, 'sync:%')).run();
  });
}
