import { AESEncryptionKey } from 'expo-crypto';
import type { Db } from '@/db/client';
import {
  createVehicle,
  removeVehicle,
  renameVehicle,
  upsertSpecs,
  specsQuery,
  vehiclesQuery,
} from '@/db/repo';
import { readSyncPref } from '@/db/sync';
import { createTestDb } from '@/db/test-utils/testDb';
import { createSyncRunner, PULL_OVERLAP_MS, syncOnce, type Remote, type SealedRow } from '..';

jest.mock('expo-crypto', () => require('@/test-utils/crypto').expoCryptoMock());

/** The server's rules, as the sync_records trigger applies them: newer copy wins, server clock. */
function fakeServer() {
  const rows = new Map<string, SealedRow & { serverUpdatedAt: string }>();
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
  };
  return { remote, rows };
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

  expect(await syncOnce(phoneA, server.remote, key)).toEqual({ pulled: 0, pushed: 3, skipped: 0 });
  // Only ciphertext on the server: the nickname is nowhere in it.
  for (const r of server.rows.values())
    expect(String.fromCharCode(...r.ciphertext)).not.toContain('Sandero');

  expect(await syncOnce(phoneB, server.remote, key)).toEqual({ pulled: 3, pushed: 0, skipped: 0 });
  expect(nicknames(phoneB)).toEqual(['Meu Sandero']);
});

test('edits, accents and soft deletes go both ways; the newer copy wins', async () => {
  const id = await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key);
  await syncOnce(phoneB, server.remote, key);

  await upsertSpecs(phoneB, id, { oilSpec: 'Óleo 5W-30 sintético — ç 🚗' });
  await syncOnce(phoneB, server.remote, key);
  await syncOnce(phoneA, server.remote, key);
  expect(specsQuery(phoneA, id).all()[0].oilSpec).toBe('Óleo 5W-30 sintético — ç 🚗');

  // Both rename offline; B's edit is later.
  await renameVehicle(phoneA, id, 'Nome de A');
  await new Promise((r) => setTimeout(r, 5));
  await renameVehicle(phoneB, id, 'Nome de B');
  await syncOnce(phoneB, server.remote, key);
  await syncOnce(phoneA, server.remote, key); // A's older edit loses on arrival
  await syncOnce(phoneB, server.remote, key);
  expect(nicknames(phoneA)).toEqual(['Nome de B']);
  expect(nicknames(phoneB)).toEqual(['Nome de B']);

  await removeVehicle(phoneB, id);
  await syncOnce(phoneB, server.remote, key);
  await syncOnce(phoneA, server.remote, key);
  expect(nicknames(phoneA)).toEqual([]);
});

test('a second sync with nothing new moves nothing', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key);
  expect(await syncOnce(phoneA, server.remote, key)).toEqual({ pulled: 0, pushed: 0, skipped: 0 });
});

test('the pull cursor is the server clock, re-read with an overlap', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key);
  const pull = jest.spyOn(server.remote, 'pull');

  await syncOnce(phoneB, server.remote, key);
  expect(pull).toHaveBeenLastCalledWith(null);
  const cursor = readSyncPref(phoneB, 'pullCursor')!;
  expect(cursor).toBe(
    [...server.rows.values()]
      .map((r) => r.serverUpdatedAt)
      .sort()
      .at(-1),
  );

  await syncOnce(phoneB, server.remote, key);
  expect(pull).toHaveBeenLastCalledWith(
    new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString(),
  );
});

test('rows sealed with another key, or tampered, are skipped and the rest lands', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  await syncOnce(phoneA, server.remote, key);
  // A child row: tampering with the car itself would also hold back its children.
  server.rows.get(
    [...server.rows.keys()].find((k) => k.startsWith('vehicle_specs'))!,
  )!.ciphertext[0] ^= 1;

  const result = await syncOnce(phoneB, server.remote, key);
  expect(result).toMatchObject({ pulled: 2, skipped: 1 });

  const other = await createTestDb();
  expect(await syncOnce(other, server.remote, await AESEncryptionKey.generate())).toMatchObject({
    pulled: 0,
    skipped: 3,
  });
});

test('a failed upload leaves the rows pending for the next run', async () => {
  await createVehicle(phoneA, { nickname: 'Meu Sandero', ...NEW_CAR }, '2026-10-01');
  const push = jest.spyOn(server.remote, 'push').mockRejectedValueOnce(new Error('offline'));
  await expect(syncOnce(phoneA, server.remote, key)).rejects.toThrow('offline');
  expect(readSyncPref(phoneA, 'lastSyncAt')).toBeNull();

  push.mockRestore();
  expect(await syncOnce(phoneA, server.remote, key)).toMatchObject({ pushed: 3 });
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
