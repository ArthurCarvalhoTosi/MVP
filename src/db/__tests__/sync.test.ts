import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { createVehicle, renameVehicle, selectVehicle, vehiclesQuery } from '../repo';
import { syncState, vehicles } from '../schema';
import {
  applyRemote,
  clearSyncState,
  markSynced,
  pendingRows,
  readSyncPref,
  writeSyncPref,
} from '../sync';
import { createTestDb } from '../test-utils/testDb';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());

let db: Db;
beforeEach(async () => {
  jest.useRealTimers();
  db = await createTestDb();
});

async function car(nickname = 'Meu Sandero') {
  return createVehicle(
    db,
    { nickname, odometerKm: 40000, monthlyKmEstimate: 1000, severeUse: false, items: [] },
    '2026-10-01',
  );
}

describe('pendingRows', () => {
  test('lists every synced row of a new car, and none of the device-local tables', async () => {
    const id = await car();
    const pending = pendingRows(db);
    expect(pending.map((r) => r.table).sort()).toEqual([
      'odometer_readings',
      'vehicle_specs',
      'vehicles',
    ]);
    const v = pending.find((r) => r.table === 'vehicles')!;
    expect(v).toMatchObject({ id, deletedAt: null, row: { id, nickname: 'Meu Sandero' } });
    expect(v.updatedAt).toBe(v.row.updatedAt);
  });

  test('a row synced at its current updated_at is no longer pending; an edit makes it pending again', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
    const id = await car();
    markSynced(db, pendingRows(db));
    expect(pendingRows(db)).toEqual([]);

    jest.setSystemTime(new Date('2026-10-01T10:00:05.000Z'));
    await renameVehicle(db, id, 'Sandero');
    expect(pendingRows(db).map((r) => [r.table, r.row.nickname])).toEqual([
      ['vehicles', 'Sandero'],
    ]);
  });

  test('an edit stamped with an earlier clock still counts (difference, not order)', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
    const id = await car();
    markSynced(db, pendingRows(db));

    // The phone's clock was set back.
    jest.setSystemTime(new Date('2026-09-01T10:00:00.000Z'));
    await renameVehicle(db, id, 'Sandero');
    expect(pendingRows(db)).toHaveLength(1);
  });

  test('an edit made while uploading stays pending', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
    const id = await car();
    const read = pendingRows(db);
    jest.setSystemTime(new Date('2026-10-01T10:00:01.000Z'));
    await renameVehicle(db, id, 'Sandero');
    markSynced(db, read); // the upload of the old copy finishes
    expect(pendingRows(db).map((r) => r.row.nickname)).toEqual(['Sandero']);
  });
});

describe('applyRemote', () => {
  const remoteCar = (over: Partial<typeof vehicles.$inferSelect> = {}) => {
    const row = {
      id: '0199f0a0-0000-7000-8000-000000000001',
      vehicleType: 'car' as const,
      modelRef: null,
      nickname: 'Do outro celular',
      plate: null,
      vin: null,
      monthlyKmEstimate: 1000,
      severeUse: false,
      createdAt: '2026-10-01T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
      deletedAt: null,
      ...over,
    };
    return { table: 'vehicles' as const, id: row.id, updatedAt: row.updatedAt, row };
  };

  test('inserts a new row with its own timestamps and marks it synced', () => {
    const r = remoteCar();
    expect(applyRemote(db, [r])).toEqual({ applied: 1, skipped: 0 });
    expect(db.select().from(vehicles).all()).toEqual([r.row]);
    expect(pendingRows(db)).toEqual([]);
  });

  test('a newer remote copy replaces the local one; an older one is left for upload', async () => {
    const r = remoteCar();
    applyRemote(db, [r]);

    applyRemote(db, [remoteCar({ nickname: 'Novo', updatedAt: '2026-10-02T09:00:00.000Z' })]);
    expect(vehiclesQuery(db).all()[0]).toMatchObject({
      nickname: 'Novo',
      updatedAt: '2026-10-02T09:00:00.000Z',
    });

    applyRemote(db, [remoteCar({ nickname: 'Velho', updatedAt: '2026-10-01T12:00:00.000Z' })]);
    expect(vehiclesQuery(db).all()[0].nickname).toBe('Novo');
  });

  test('a local edit newer than the remote copy wins and stays pending', async () => {
    applyRemote(db, [remoteCar()]);
    await renameVehicle(db, remoteCar().id, 'Local'); // now, later than 2026-10-01
    applyRemote(db, [remoteCar({ nickname: 'Remoto', updatedAt: '2026-10-01T10:00:00.000Z' })]);
    expect(vehiclesQuery(db).all()[0].nickname).toBe('Local');
    expect(pendingRows(db).map((r) => r.row.nickname)).toEqual(['Local']);
  });

  test('a soft delete from the other phone lands', () => {
    applyRemote(db, [remoteCar()]);
    const deletedAt = '2026-10-03T09:00:00.000Z';
    applyRemote(db, [remoteCar({ updatedAt: deletedAt, deletedAt })]);
    expect(vehiclesQuery(db).all()).toEqual([]);
  });

  test('children arriving before their parent still land (foreign keys)', () => {
    const parent = remoteCar();
    const reading = {
      table: 'odometer_readings' as const,
      id: '0199f0a0-0000-7000-8000-000000000002',
      updatedAt: '2026-10-01T09:00:00.000Z',
      row: {
        id: '0199f0a0-0000-7000-8000-000000000002',
        vehicleId: parent.id,
        km: 40000,
        readAt: '2026-10-01',
        source: 'onboarding',
        logId: null,
        createdAt: '2026-10-01T09:00:00.000Z',
        updatedAt: '2026-10-01T09:00:00.000Z',
        deletedAt: null,
      },
    };
    expect(applyRemote(db, [reading, parent])).toEqual({ applied: 2, skipped: 0 });
  });

  test('a row that does not fit is skipped alone', () => {
    const broken = { ...remoteCar({ id: 'x' }), id: 'x', row: { id: 'x', nickname: null } };
    expect(applyRemote(db, [broken as never, remoteCar()])).toEqual({ applied: 1, skipped: 1 });
    expect(vehiclesQuery(db).all()).toHaveLength(1);
    expect(db.select().from(syncState).where(eq(syncState.rowId, 'x')).all()).toEqual([]);
  });
});

test('clearSyncState forgets the bookkeeping but keeps data and other prefs', async () => {
  const id = await car();
  await selectVehicle(db, id);
  markSynced(db, pendingRows(db));
  writeSyncPref(db, 'pullCursor', '2026-10-01T10:00:00Z');

  clearSyncState(db);
  expect(readSyncPref(db, 'pullCursor')).toBeNull();
  expect(pendingRows(db)).toHaveLength(3);
  expect(vehiclesQuery(db).all()).toHaveLength(1);
});
