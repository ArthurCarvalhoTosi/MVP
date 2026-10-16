import { eq, sql } from 'drizzle-orm';
import { MAX_KM, READING_ERRORS, ValidationError } from '@/domain';
import type { Db } from '../client';
import {
  addOdometerReading,
  createVehicle,
  itemsQuery,
  logsQuery,
  OdometerError,
  readingsQuery,
  registerMaintenance,
  setSnooze,
  specsQuery,
  upsertSpecs,
  vehicleQuery,
} from '../repo';
import { maintenanceItems, maintenanceLogs, odometerReadings, vehicleSpecs, vehicles } from '../schema';
import { createTestDb } from '../test-utils/testDb';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const TODAY = '2026-10-01';
const OIL = { templateKey: 'oil', name: 'Troca de óleo', intervalKm: 10000, intervalMonths: 12 };
const TIRES = { templateKey: null, name: 'Rodízio de pneus', intervalKm: 10000, intervalMonths: null };

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(() => jest.useRealTimers());

function seed(overrides: Partial<Parameters<typeof createVehicle>[1]> = {}) {
  return createVehicle(
    db,
    { nickname: ' Meu carro ', odometerKm: 50000, monthlyKmEstimate: 1000, severeUse: false, items: [OIL, TIRES], ...overrides },
    TODAY,
  );
}

async function seedWithItems() {
  const vehicleId = await seed();
  const items = itemsQuery(db, vehicleId).all();
  const idOf = (name: string) => items.find((i) => i.name === name)!.id;
  return { vehicleId, oilId: idOf(OIL.name), tiresId: idOf(TIRES.name) };
}

const item = (id: string) => db.select().from(maintenanceItems).where(eq(maintenanceItems.id, id)).get()!;

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
}

/** Rejected with a ValidationError, whose pt-BR message the UI may show as is. */
async function expectValidation(p: Promise<unknown>, message: string) {
  const err = await rejection(p);
  expect(err).toBeInstanceOf(ValidationError);
  expect((err as Error).message).toBe(message);
}

function expectOdometerError(err: unknown, check: 'below_previous' | 'above_next') {
  expect(err).toBeInstanceOf(OdometerError);
  expect(err).toBeInstanceOf(ValidationError);
  expect(err).toMatchObject({ check, message: READING_ERRORS[check] });
}

describe('createVehicle', () => {
  test('creates vehicle, onboarding reading, items at baseline and an empty specs row', async () => {
    const vehicleId = await seed();

    expect(vehicleQuery(db).all()).toEqual([
      expect.objectContaining({ id: vehicleId, nickname: 'Meu carro', vehicleType: 'car', monthlyKmEstimate: 1000, severeUse: false }),
    ]);
    expect(db.select().from(odometerReadings).all()).toEqual([
      expect.objectContaining({ vehicleId, km: 50000, readAt: TODAY, source: 'onboarding' }),
    ]);
    const items = itemsQuery(db, vehicleId).all();
    expect(items).toHaveLength(2);
    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ...OIL, baselineKm: 50000, baselineDate: TODAY, active: true, snoozedUntil: null }),
        expect.objectContaining({ ...TIRES, baselineKm: 50000, baselineDate: TODAY, active: true }),
      ]),
    );
    expect(specsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ vehicleId, oilSpec: null })]);
  });

  test.each([
    ['empty nickname', { nickname: '   ' }, 'Informe um apelido para o veículo.'],
    ['negative km', { odometerKm: -1 }, 'Quilometragem inválida.'],
    ['fractional km', { odometerKm: 1.5 }, 'Quilometragem inválida.'],
    ['km above MAX_KM', { odometerKm: MAX_KM + 1 }, 'Quilometragem inválida.'],
    ['item without name', { items: [{ ...OIL, name: ' ' }] }, 'Informe o nome do item.'],
    ['item without interval', { items: [{ ...OIL, intervalKm: null, intervalMonths: null }] }, 'Informe um intervalo em km ou em meses.'],
    ['zero interval', { items: [{ ...OIL, intervalKm: 0 }] }, 'Intervalo inválido.'],
  ])('rejects %s and writes nothing', async (_, overrides, message) => {
    await expectValidation(seed(overrides), message);
    expect(db.select().from(vehicles).all()).toEqual([]);
  });

  test('accepts km exactly at MAX_KM', async () => {
    const vehicleId = await seed({ odometerKm: MAX_KM });
    expect(readingsQuery(db, vehicleId).all()).toEqual([{ km: 2_000_000, readAt: TODAY }]);
  });

  test.each(['2026-02-30', '01/10/2026', '2026-1-1', ''])('rejects bad date %p', async (today) => {
    await expectValidation(
      createVehicle(db, { nickname: 'Carro', odometerKm: 0, monthlyKmEstimate: 0, severeUse: false, items: [] }, today),
      'Data inválida.',
    );
  });
});

test('CHECK constraint rejects an item with neither interval', async () => {
  const vehicleId = await seed({ items: [] });
  expect(() =>
    db
      .insert(maintenanceItems)
      .values({ id: 'x', vehicleId, name: 'X', intervalKm: null, intervalMonths: null, baselineKm: 0, baselineDate: TODAY })
      .run(),
  ).toThrow('CHECK constraint failed: maintenance_items_interval_check');
  expect(db.select().from(maintenanceItems).all()).toEqual([]);
});

describe('addOdometerReading', () => {
  test('accepts a consistent reading and rejects out-of-order ones', async () => {
    const vehicleId = await seed();
    await addOdometerReading(db, vehicleId, 52000, '2026-11-01', 'adjust');

    expectOdometerError(await rejection(addOdometerReading(db, vehicleId, 49000, '2026-10-15', 'adjust')), 'below_previous');
    expectOdometerError(await rejection(addOdometerReading(db, vehicleId, 53000, '2026-10-15', 'adjust')), 'above_next');

    expect(readingsQuery(db, vehicleId).all()).toEqual([
      { km: 50000, readAt: TODAY },
      { km: 52000, readAt: '2026-11-01' },
    ]);
  });

  test('validates km (0..MAX_KM integer) and date', async () => {
    const vehicleId = await seed();
    await expectValidation(addOdometerReading(db, vehicleId, -5, TODAY, 'adjust'), 'Quilometragem inválida.');
    await expectValidation(addOdometerReading(db, vehicleId, MAX_KM + 1, '2026-11-01', 'adjust'), 'Quilometragem inválida.');
    await expectValidation(addOdometerReading(db, vehicleId, 51000, '2026-13-01', 'adjust'), 'Data inválida.');

    await addOdometerReading(db, vehicleId, MAX_KM, '2026-11-01', 'adjust');
    expect(readingsQuery(db, vehicleId).all().map((r) => r.km)).toEqual([50000, 2_000_000]);
  });

  describe('correct', () => {
    // 40.000 km on 2026-09-01; the oil log on 2026-10-01 accepted the projected 43.200 km,
    // but the panel shows 41.100 km on 2026-10-15.
    async function seedOverestimatedLog() {
      jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
      const vehicleId = await createVehicle(
        db,
        { nickname: 'Carro', odometerKm: 40000, monthlyKmEstimate: 1000, severeUse: false, items: [OIL, TIRES] },
        '2026-09-01',
      );
      const items = itemsQuery(db, vehicleId).all();
      const oilId = items.find((i) => i.name === OIL.name)!.id;
      const tiresId = items.find((i) => i.name === TIRES.name)!.id;
      await registerMaintenance(db, { vehicleId, itemId: oilId, performedAt: '2026-10-01', km: 43200 });
      jest.setSystemTime(new Date('2026-10-15T10:00:00.000Z'));
      return { vehicleId, oilId, tiresId };
    }

    const allReadings = () =>
      db
        .select({ km: odometerReadings.km, source: odometerReadings.source, updatedAt: odometerReadings.updatedAt, deletedAt: odometerReadings.deletedAt })
        .from(odometerReadings)
        .orderBy(odometerReadings.readAt)
        .all();

    test('without correct, a panel km below a log reading is rejected', async () => {
      const { vehicleId } = await seedOverestimatedLog();
      expectOdometerError(await rejection(addOdometerReading(db, vehicleId, 41100, '2026-10-15', 'adjust')), 'below_previous');
    });

    test('soft-deletes the readings above it, clamps baselines and keeps logs', async () => {
      const { vehicleId, oilId, tiresId } = await seedOverestimatedLog();

      await addOdometerReading(db, vehicleId, 41100, '2026-10-15', 'adjust', { correct: true });

      const now = '2026-10-15T10:00:00.000Z';
      expect(allReadings()).toEqual([
        { km: 40000, source: 'onboarding', updatedAt: '2026-10-01T10:00:00.000Z', deletedAt: null },
        { km: 43200, source: 'log', updatedAt: now, deletedAt: now },
        { km: 41100, source: 'adjust', updatedAt: now, deletedAt: null },
      ]);
      expect(readingsQuery(db, vehicleId).all()).toEqual([
        { km: 40000, readAt: '2026-09-01' },
        { km: 41100, readAt: '2026-10-15' },
      ]);
      expect(item(oilId)).toMatchObject({ baselineKm: 41100, baselineDate: '2026-10-01' });
      expect(item(tiresId)).toMatchObject({ baselineKm: 40000, baselineDate: '2026-09-01' });
      expect(logsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ itemId: oilId, km: 43200, performedAt: '2026-10-01' })]);
    });

    test('rolls everything back when the insert fails', async () => {
      const { vehicleId, oilId } = await seedOverestimatedLog();
      const before = allReadings();
      db.run(sql`CREATE TRIGGER fail_insert BEFORE INSERT ON odometer_readings BEGIN SELECT RAISE(ABORT, 'boom'); END`);

      await expect(addOdometerReading(db, vehicleId, 41100, '2026-10-15', 'adjust', { correct: true })).rejects.toThrow('boom');

      expect(allReadings()).toEqual(before);
      expect(item(oilId)).toMatchObject({ baselineKm: 43200 });
    });

    test('still rejects a km above a later reading', async () => {
      const { vehicleId, oilId } = await seedOverestimatedLog();
      const before = allReadings();

      expectOdometerError(
        await rejection(addOdometerReading(db, vehicleId, 44000, '2026-09-15', 'adjust', { correct: true })),
        'above_next',
      );

      expect(allReadings()).toEqual(before);
      expect(item(oilId)).toMatchObject({ baselineKm: 43200 });
    });
  });
});

describe('registerMaintenance', () => {
  test('a current log moves the baseline, clears snooze and adds a log reading', async () => {
    const { vehicleId, oilId } = await seedWithItems();
    await setSnooze(db, oilId, '2026-10-20');

    await registerMaintenance(db, {
      vehicleId,
      itemId: oilId,
      performedAt: '2026-11-01',
      km: 51000,
      costCents: 25000,
      brandSpec: ' 5W30 ',
      notes: '',
    });

    expect(item(oilId)).toMatchObject({ baselineKm: 51000, baselineDate: '2026-11-01', snoozedUntil: null });
    expect(logsQuery(db, vehicleId).all()).toEqual([
      expect.objectContaining({ itemId: oilId, itemName: 'Troca de óleo', km: 51000, costCents: 25000, brandSpec: '5W30', notes: null }),
    ]);
    expect(db.select().from(odometerReadings).where(eq(odometerReadings.source, 'log')).all()).toEqual([
      expect.objectContaining({ km: 51000, readAt: '2026-11-01' }),
    ]);
  });

  test('a retroactive log is kept but does not move the baseline', async () => {
    const { vehicleId, oilId } = await seedWithItems();
    await setSnooze(db, oilId, '2026-10-20');

    await registerMaintenance(db, { vehicleId, itemId: oilId, performedAt: '2026-06-01', km: 45000 });

    expect(item(oilId)).toMatchObject({ baselineKm: 50000, baselineDate: TODAY, snoozedUntil: '2026-10-20' });
    expect(logsQuery(db, vehicleId).all()).toHaveLength(1);
    expect(readingsQuery(db, vehicleId).all()).toEqual([
      { km: 45000, readAt: '2026-06-01' },
      { km: 50000, readAt: TODAY },
    ]);
  });

  test('invalid km rolls back everything and leaves the connection usable', async () => {
    const { vehicleId, oilId } = await seedWithItems();

    expectOdometerError(
      await rejection(registerMaintenance(db, { vehicleId, itemId: oilId, performedAt: '2026-11-01', km: 40000 })),
      'below_previous',
    );
    expect(db.select().from(maintenanceLogs).all()).toEqual([]);
    expect(readingsQuery(db, vehicleId).all()).toHaveLength(1);
    expect(item(oilId)).toMatchObject({ baselineKm: 50000, baselineDate: TODAY });

    await registerMaintenance(db, { vehicleId, itemId: null, performedAt: '2026-11-01', km: 51000 });
    expect(logsQuery(db, vehicleId).all()).toHaveLength(1);
  });

  test('rejects negative cost, km above MAX_KM and unknown item', async () => {
    const { vehicleId } = await seedWithItems();
    await expectValidation(
      registerMaintenance(db, { vehicleId, itemId: null, performedAt: TODAY, km: 50000, costCents: -1 }),
      'Valor inválido.',
    );
    await expectValidation(
      registerMaintenance(db, { vehicleId, itemId: null, performedAt: TODAY, km: MAX_KM + 1 }),
      'Quilometragem inválida.',
    );
    await expectValidation(
      registerMaintenance(db, { vehicleId, itemId: 'nope', performedAt: TODAY, km: 50000 }),
      'Item de manutenção não encontrado.',
    );
    expect(db.select().from(maintenanceLogs).all()).toEqual([]);

    await registerMaintenance(db, { vehicleId, itemId: null, performedAt: TODAY, km: MAX_KM });
    expect(logsQuery(db, vehicleId).all().map((l) => l.km)).toEqual([2_000_000]);
  });
});

test('setSnooze sets and clears the date and refreshes updatedAt', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
  const { oilId } = await seedWithItems();

  jest.setSystemTime(new Date('2026-10-02T10:00:00.000Z'));
  await setSnooze(db, oilId, '2026-10-20');
  expect(item(oilId)).toMatchObject({
    snoozedUntil: '2026-10-20',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
  });

  await setSnooze(db, oilId, null);
  expect(item(oilId).snoozedUntil).toBeNull();
  await expectValidation(setSnooze(db, oilId, '20/10/2026'), 'Data inválida.');
});

test('upsertSpecs updates only the given fields and inserts when the row is missing', async () => {
  const vehicleId = await seed();
  await upsertSpecs(db, vehicleId, { oilSpec: '5W30', tireFrontPsi: 32 });
  await upsertSpecs(db, vehicleId, { tireRearPsi: 30 });
  expect(specsQuery(db, vehicleId).get()).toMatchObject({ oilSpec: '5W30', tireFrontPsi: 32, tireRearPsi: 30, battery: null });

  db.delete(vehicleSpecs).run();
  await upsertSpecs(db, vehicleId, { battery: '60Ah' });
  expect(specsQuery(db, vehicleId).get()).toMatchObject({ battery: '60Ah', oilSpec: null });

  await expectValidation(upsertSpecs(db, vehicleId, { tireFrontPsi: -1 }), 'Calibragem inválida.');
});

test('soft-deleted rows are excluded from reads; inactive items too', async () => {
  const { vehicleId, oilId, tiresId } = await seedWithItems();
  await registerMaintenance(db, { vehicleId, itemId: null, performedAt: '2026-11-01', km: 51000 });
  await registerMaintenance(db, { vehicleId, itemId: null, performedAt: '2026-12-01', km: 52000 });
  const deletedAt = '2026-12-02T00:00:00.000Z';

  db.update(maintenanceItems).set({ deletedAt }).where(eq(maintenanceItems.id, oilId)).run();
  expect(itemsQuery(db, vehicleId).all().map((i) => i.id)).toEqual([tiresId]);
  db.update(maintenanceItems).set({ active: false }).where(eq(maintenanceItems.id, tiresId)).run();
  expect(itemsQuery(db, vehicleId).all()).toEqual([]);

  db.update(maintenanceLogs).set({ deletedAt }).where(eq(maintenanceLogs.km, 52000)).run();
  expect(logsQuery(db, vehicleId).all().map((l) => l.km)).toEqual([51000]);

  db.update(odometerReadings).set({ deletedAt }).where(eq(odometerReadings.km, 52000)).run();
  expect(readingsQuery(db, vehicleId).all().map((r) => r.km)).toEqual([50000, 51000]);

  db.update(vehicles).set({ deletedAt }).where(eq(vehicles.id, vehicleId)).run();
  expect(vehicleQuery(db).all()).toEqual([]);
});

test('logsQuery orders by performedAt desc, then createdAt desc, and joins itemName', async () => {
  jest.useFakeTimers({ now: new Date('2026-12-01T10:00:00.000Z') });
  const { vehicleId, oilId, tiresId } = await seedWithItems();

  await registerMaintenance(db, { vehicleId, itemId: oilId, performedAt: '2026-11-01', km: 51000 });
  jest.setSystemTime(new Date('2026-12-01T10:00:01.000Z'));
  await registerMaintenance(db, { vehicleId, itemId: null, performedAt: '2026-12-01', km: 52000 });
  jest.setSystemTime(new Date('2026-12-01T10:00:02.000Z'));
  await registerMaintenance(db, { vehicleId, itemId: tiresId, performedAt: '2026-12-01', km: 52000 });
  // History keeps the name of a removed item.
  db.update(maintenanceItems).set({ deletedAt: '2026-12-02T00:00:00.000Z' }).where(eq(maintenanceItems.id, oilId)).run();

  expect(logsQuery(db, vehicleId).all().map((l) => [l.performedAt, l.itemName])).toEqual([
    ['2026-12-01', 'Rodízio de pneus'],
    ['2026-12-01', null],
    ['2026-11-01', 'Troca de óleo'],
  ]);
});
