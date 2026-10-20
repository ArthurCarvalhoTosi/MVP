import { AESEncryptionKey } from 'expo-crypto';
import type { Db } from '@/db/client';
import {
  createVehicle,
  logsQuery,
  registerMaintenance,
  removeMaintenance,
  removeVehicle,
  renameVehicle,
  upsertSpecs,
  specsQuery,
  vehiclesQuery,
} from '@/db/repo';
import { clearSyncState, readSyncPref } from '@/db/sync';
import { createTestDb } from '@/db/test-utils/testDb';
import { memoryPhotos } from '@/test-utils/photos';
import { createSyncRunner, PULL_OVERLAP_MS, syncOnce, type Remote, type SealedRow } from '..';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());

/** The server's rules, as the sync_records trigger applies them: newer copy wins, server clock. */
function fakeServer() {
  const rows = new Map<string, SealedRow & { serverUpdatedAt: string }>();
  const photos = new Map<string, Uint8Array>();
  let clock = Date.parse('2026-10-20T12:00:00.000Z');
  const remote: Remote = {
    async pull(since) {
      return [...rows.values()]
        .filter((r) => !since || Date.parse(r.serverUpdatedAt) > Date.parse(since))
        .sort((a, b) => Date.parse(a.serverUpdatedAt) - Date.parse(b.serverUpdatedAt));
    },
    async push(batch) {
      for (const r of batch) {
        const k = `${r.table}:${r.id}`;
        const old = rows.get(k);
        if (old && r.updatedAt <= old.updatedAt) continue;
        clock += 1000;
        rows.set(k, { ...r, serverUpdatedAt: new Date(clock).toISOString() });
      }
    },
    async uploadPhoto(id, sealed) {
      photos.set(id, sealed);
    },
    async downloadPhoto(id) {
      return photos.get(id) ?? null;
    },
    async removePhotos(ids) {
      for (const id of ids) photos.delete(id);
    },
  };
  return { remote, rows, photos };
}

const phonePhotos = new WeakMap<Db, ReturnType<typeof memoryPhotos>>();
function photosOf(db: Db) {
  if (!phonePhotos.has(db)) phonePhotos.set(db, memoryPhotos());
  return phonePhotos.get(db)!;
}

const NEW_CAR = { odometerKm: 40000, monthlyKmEstimate: 1000, severeUse: false, items: [] };

let key: AESEncryptionKey;
let phoneA: Db;
let phoneB: Db;
let server: ReturnType<typeof fakeServer>;

beforeEach(async () => {
  jest.useRealTimers();
  key = await AESEncryptionKey.generate();
  phoneA = await createTestDb();
  phoneB = await createTestDb();
  server = fakeServer();
});

const nicknames = (db: Db) =>
  vehiclesQuery(db)
    .all()
    .map((v) => v.nickname)
    .sort();

test('a car made on one phone shows up on the other, sealed on the server', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');

  expect(await syncOnce(phoneA, server.remote, key, photosOf(phoneA))).toEqual({
    pulled: 0,
    pushed: 3,
    skipped: 0,
  });
  // Only ciphertext on the server: the nickname is nowhere in it.
  for (const r of server.rows.values())
    expect(String.fromCharCode(...r.ciphertext)).not.toContain('Sandero');

  expect(await syncOnce(phoneB, server.remote, key, photosOf(phoneB))).toEqual({
    pulled: 3,
    pushed: 0,
    skipped: 0,
  });
  expect(nicknames(phoneB)).toEqual(['Meu Sandero']);
});

test('edits, accents and soft deletes go both ways; the newer copy wins', async () => {
  const id = await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
  await syncOnce(phoneB, server.remote, key, photosOf(phoneB));

  await upsertSpecs(phoneB, id, { oilSpec: 'Óleo 5W-30 sintético — ç 🚗' });
  await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
  await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
  expect(specsQuery(phoneA, id).all()[0].oilSpec).toBe('Óleo 5W-30 sintético — ç 🚗');

  // Both rename offline; B's edit is later.
  await renameVehicle(phoneA, id, 'Nome de A');
  await new Promise((r) => setTimeout(r, 5));
  await renameVehicle(phoneB, id, 'Nome de B');
  await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
  await syncOnce(phoneA, server.remote, key, photosOf(phoneA)); // A's older edit loses on arrival
  await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
  expect(nicknames(phoneA)).toEqual(['Nome de B']);
  expect(nicknames(phoneB)).toEqual(['Nome de B']);

  await removeVehicle(phoneB, id);
  await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
  await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
  expect(nicknames(phoneA)).toEqual([]);
});

test('a second sync with nothing new moves nothing', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
  expect(await syncOnce(phoneA, server.remote, key, photosOf(phoneA))).toEqual({
    pulled: 0,
    pushed: 0,
    skipped: 0,
  });
});

test('the pull cursor is the server clock, re-read with an overlap', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
  const pull = jest.spyOn(server.remote, 'pull');

  await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
  expect(pull).toHaveBeenLastCalledWith(null);
  const cursor = readSyncPref(phoneB, 'pullCursor')!;
  expect(cursor).toBe(
    [...server.rows.values()]
      .map((r) => r.serverUpdatedAt)
      .sort()
      .at(-1),
  );

  await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
  expect(pull).toHaveBeenLastCalledWith(
    new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString(),
  );
});

test('rows sealed with another key, or tampered, are skipped and the rest lands', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
  // A child row: tampering with the car itself would also hold back its children.
  server.rows.get(
    [...server.rows.keys()].find((k) => k.startsWith('vehicle_specs'))!,
  )!.ciphertext[0] ^= 1;

  const result = await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
  expect(result).toMatchObject({ pulled: 2, skipped: 1 });

  const other = await createTestDb();
  expect(
    await syncOnce(other, server.remote, await AESEncryptionKey.generate(), photosOf(other)),
  ).toMatchObject({
    pulled: 0,
    skipped: 3,
  });
});

test('a failed upload leaves the rows pending for the next run', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  const push = jest.spyOn(server.remote, 'push').mockRejectedValueOnce(new Error('offline'));
  await expect(syncOnce(phoneA, server.remote, key, photosOf(phoneA))).rejects.toThrow('offline');
  expect(readSyncPref(phoneA, 'lastSyncAt')).toBeNull();

  push.mockRestore();
  expect(await syncOnce(phoneA, server.remote, key, photosOf(phoneA))).toMatchObject({ pushed: 3 });
});

describe('receipt photos', () => {
  const NodeBuffer = require('buffer').Buffer; // no @types/node here
  // Stands in for a JPEG (base64); only the bytes matter here.
  const JPEG = NodeBuffer.from('jpeg do comprovante: CPF 123.456.789-00').toString('base64');

  async function carWithPhoto(db: Db) {
    const vehicleId = await createVehicle(
      db,
      { nickname: 'Meu Sandero', ...NEW_CAR },
      '2026-10-01',
    );
    const filePath = 'attachments/local-a.bin';
    await photosOf(db).write(filePath, JPEG);
    await registerMaintenance(db, {
      vehicleId,
      itemId: null,
      performedAt: '2026-10-10',
      km: 41000,
      attachment: { filePath, mime: 'image/jpeg', sizeBytes: 100 },
    });
    const log = logsQuery(db, vehicleId).all()[0];
    return { vehicleId, logId: log.id };
  }

  const attachmentRows = () => [...server.rows.values()].filter((r) => r.table === 'attachments');

  test('a photo reaches the other phone, sealed in the cloud and kept under its own name', async () => {
    const { vehicleId } = await carWithPhoto(phoneA);
    expect(await syncOnce(phoneA, server.remote, key, photosOf(phoneA))).toMatchObject({
      pushed: 6,
    });

    const [row] = attachmentRows();
    const sealed = server.photos.get(row.id)!;
    expect(NodeBuffer.from(sealed).toString()).not.toContain('CPF');
    // The sending phone's file name stays on that phone.
    expect(NodeBuffer.from(row.ciphertext).toString()).not.toContain('local-a');

    await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
    const photo = logsQuery(phoneB, vehicleId).all()[0].photo;
    expect(photo).toBe(`attachments/${row.id}.bin`);
    expect(photosOf(phoneB).files.get(photo!)).toBe(JPEG);
  });

  test('the file goes up before its row; a failed upload holds the row back', async () => {
    await carWithPhoto(phoneA);
    jest.spyOn(server.remote, 'uploadPhoto').mockRejectedValueOnce(new Error('offline'));
    await expect(syncOnce(phoneA, server.remote, key, photosOf(phoneA))).rejects.toThrow();
    expect(attachmentRows()).toHaveLength(0);

    await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
    expect(attachmentRows()).toHaveLength(1);
    expect(server.photos.size).toBe(1);
  });

  test('a photo this phone cannot read keeps its row here; everything else goes', async () => {
    await carWithPhoto(phoneA);
    photosOf(phoneA).files.clear();

    expect(await syncOnce(phoneA, server.remote, key, photosOf(phoneA))).toMatchObject({
      pushed: 5,
    });
    expect(attachmentRows()).toHaveLength(0);
  });

  test('removing the log removes the photo from the cloud and from the other phone', async () => {
    const { logId } = await carWithPhoto(phoneA);
    await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
    await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
    expect(photosOf(phoneB).files.size).toBe(1);

    await removeMaintenance(phoneB, logId);
    await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
    expect(server.photos.size).toBe(0);
    expect(attachmentRows()[0].deletedAt).not.toBeNull();

    // A has not deleted its own file itself: the sync does it.
    await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
    expect(photosOf(phoneA).files.size).toBe(0);
  });

  test('a tampered or swapped photo is skipped; one not in the cloud yet waits', async () => {
    await carWithPhoto(phoneA);
    await syncOnce(phoneA, server.remote, key, photosOf(phoneA));
    const [row] = attachmentRows();
    const good = server.photos.get(row.id)!;

    const tampered = good.slice();
    tampered[20] ^= 1;
    server.photos.set(row.id, tampered);
    expect(await syncOnce(phoneB, server.remote, key, photosOf(phoneB))).toMatchObject({
      skipped: 1,
    });
    expect(photosOf(phoneB).files.size).toBe(0);

    server.photos.delete(row.id);
    expect(await syncOnce(phoneB, server.remote, key, photosOf(phoneB))).toMatchObject({
      skipped: 0,
    });

    server.photos.set(row.id, good);
    await syncOnce(phoneB, server.remote, key, photosOf(phoneB));
    expect(photosOf(phoneB).files.size).toBe(1);
  });

  test('another account signing in on the phone uploads the photo again', async () => {
    await carWithPhoto(phoneA);
    await syncOnce(phoneA, server.remote, key, photosOf(phoneA));

    clearSyncState(phoneA);
    server = fakeServer();
    await syncOnce(phoneA, server.remote, await AESEncryptionKey.generate(), photosOf(phoneA));
    expect(server.photos.size).toBe(1);
    expect(attachmentRows()).toHaveLength(1);
  });
});

describe('createSyncRunner', () => {
  test('one run at a time; a request mid-run queues exactly one more', async () => {
    let release: () => void = () => {};
    const run = jest.fn(() => new Promise<void>((r) => (release = r)));
    const runner = createSyncRunner(run, 1000);

    const first = runner.now();
    void runner.now();
    void runner.now();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await first;
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('soon waits for a pause in edits', async () => {
    jest.useFakeTimers();
    const run = jest.fn(async () => {});
    const runner = createSyncRunner(run, 1000);
    runner.soon();
    jest.advanceTimersByTime(800);
    runner.soon();
    jest.advanceTimersByTime(800);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(run).toHaveBeenCalledTimes(1);
    runner.soon();
    runner.cancel();
    jest.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  test('a failing run does not wedge the runner', async () => {
    const run = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const runner = createSyncRunner(run, 1000);
    await expect(runner.now()).rejects.toThrow('x');
    await runner.now();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
