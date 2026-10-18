import { and, eq, inArray, sql } from 'drizzle-orm';
import { CAR_MODELS, MAX_KM, modelSpecs, READING_ERRORS, ValidationError } from '@/domain';
import type { Db } from '../client';
import {
  addOdometerReading,
  allItemsQuery,
  allReadingsQuery,
  createVehicle,
  itemsQuery,
  logsQuery,
  OdometerError,
  readingsQuery,
  registerMaintenance,
  removeVehicle,
  selectedVehicleIdQuery,
  selectVehicle,
  setSnooze,
  specsQuery,
  upsertSpecs,
  vehiclesQuery,
} from '../repo';
import {
  attachments,
  devicePrefs,
  maintenanceItems,
  maintenanceLogs,
  odometerReadings,
  vehicleSpecs,
  vehicles,
} from '../schema';
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

async function seedWithItems(overrides: Parameters<typeof seed>[0] = {}) {
  const vehicleId = await seed(overrides);
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
  test('creates vehicle, onboarding reading, items at baseline and an empty specs row, and selects it', async () => {
    const vehicleId = await seed();

    expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: vehicleId }]);
    expect(vehiclesQuery(db).all()).toEqual([
      expect.objectContaining({ id: vehicleId, nickname: 'Meu carro', vehicleType: 'car', modelRef: null, monthlyKmEstimate: 1000, severeUse: false }),
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
    expect(db.select().from(devicePrefs).all()).toEqual([]);
  });

  test('with a seed model, stores its id and copies its specs into the cola de bolso', async () => {
    const model = CAR_MODELS.find((m) => m.oil && m.tireFrontPsi && m.batteryAh)!;
    const vehicleId = await seed({ modelRef: model.id });

    expect(vehiclesQuery(db).all()[0].modelRef).toBe(model.id);
    expect(specsQuery(db, vehicleId).all()).toEqual([expect.objectContaining({ vehicleId, ...modelSpecs(model) })]);
  });

  test('rejects a model missing from the seed and writes nothing', async () => {
    await expectValidation(seed({ modelRef: 'carro-que-nao-existe' }), 'Modelo não encontrado.');
    expect(db.select().from(vehicles).all()).toEqual([]);
    expect(db.select().from(vehicleSpecs).all()).toEqual([]);
  });

  test('a second vehicle becomes the selected one', async () => {
    await seed();
    const second = await seed({ nickname: 'Moto' });

    expect(vehiclesQuery(db).all()).toHaveLength(2);
    expect(db.select().from(devicePrefs).all()).toEqual([expect.objectContaining({ key: 'selectedVehicleId', value: second })]);
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
  expect(vehiclesQuery(db).all()).toEqual([]);
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

test('vehiclesQuery orders by createdAt, then id, and skips removed vehicles', () => {
  const car = (id: string, createdAt: string, deletedAt: string | null = null) => ({
    id,
    nickname: id,
    monthlyKmEstimate: 0,
    createdAt,
    deletedAt,
  });
  db.insert(vehicles)
    .values([
      car('b', '2026-10-02T00:00:00.000Z'),
      car('c', '2026-10-01T00:00:00.000Z'),
      car('a', '2026-10-02T00:00:00.000Z'),
      car('d', '2026-09-01T00:00:00.000Z', '2026-10-03T00:00:00.000Z'),
    ])
    .run();

  expect(vehiclesQuery(db).all().map((v) => v.id)).toEqual(['c', 'a', 'b']);
});

describe('selectVehicle', () => {
  test('updates the existing pref (refreshing updatedAt) or inserts it when missing', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
    const first = await seed();
    const second = await seed();

    jest.setSystemTime(new Date('2026-10-02T10:00:00.000Z'));
    await selectVehicle(db, first);
    expect(db.select().from(devicePrefs).all()).toEqual([
      { key: 'selectedVehicleId', value: first, updatedAt: '2026-10-02T10:00:00.000Z' },
    ]);

    db.delete(devicePrefs).run();
    await selectVehicle(db, second);
    expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: second }]);
  });

  test('rejects an unknown or removed vehicle and keeps the selection', async () => {
    const first = await seed();
    const second = await seed();
    await removeVehicle(db, first);

    await expectValidation(selectVehicle(db, 'nope'), 'Carro não encontrado.');
    await expectValidation(selectVehicle(db, first), 'Carro não encontrado.');
    expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: second }]);
  });
});

describe('removeVehicle', () => {
  const REMOVED_AT = '2026-10-15T10:00:00.000Z';

  /** Every synced row of a vehicle; attachments through its logs. */
  function rowsOf(vehicleId: string) {
    const logIds = db.select({ id: maintenanceLogs.id }).from(maintenanceLogs).where(eq(maintenanceLogs.vehicleId, vehicleId));
    return {
      vehicles: db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).all(),
      odometerReadings: db.select().from(odometerReadings).where(eq(odometerReadings.vehicleId, vehicleId)).all(),
      maintenanceItems: db.select().from(maintenanceItems).where(eq(maintenanceItems.vehicleId, vehicleId)).all(),
      maintenanceLogs: db.select().from(maintenanceLogs).where(eq(maintenanceLogs.vehicleId, vehicleId)).all(),
      attachments: db.select().from(attachments).where(inArray(attachments.logId, logIds)).all(),
      vehicleSpecs: db.select().from(vehicleSpecs).where(eq(vehicleSpecs.vehicleId, vehicleId)).all(),
    };
  }

  // Two cars, each with a log and an attachment; the second one is selected. Removal happens at REMOVED_AT.
  async function seedTwo() {
    jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
    const ids: string[] = [];
    for (const n of [1, 2]) {
      const { vehicleId, oilId } = await seedWithItems();
      await registerMaintenance(db, { vehicleId, itemId: oilId, performedAt: '2026-10-05', km: 51000 });
      const [log] = logsQuery(db, vehicleId).all();
      db.insert(attachments).values({ id: `att${n}`, logId: log.id, filePath: `f${n}`, mime: 'image/jpeg', sizeBytes: 1 }).run();
      ids.push(vehicleId);
    }
    jest.setSystemTime(new Date(REMOVED_AT));
    return { a: ids[0], b: ids[1] };
  }

  const stamps = (rows: { deletedAt: string | null; updatedAt: string }[]) => rows.map((r) => [r.deletedAt, r.updatedAt]);

  test('soft-deletes the vehicle and every child row, keeping earlier deletions as they were', async () => {
    const { a } = await seedTwo();
    const earlier = '2026-10-10T00:00:00.000Z';
    db.update(odometerReadings)
      .set({ deletedAt: earlier, updatedAt: earlier })
      .where(and(eq(odometerReadings.vehicleId, a), eq(odometerReadings.source, 'log')))
      .run();

    await removeVehicle(db, a);

    const removed = [REMOVED_AT, REMOVED_AT];
    const rows = rowsOf(a);
    expect(stamps(rows.vehicles)).toEqual([removed]);
    expect(stamps(rows.odometerReadings)).toEqual([removed, [earlier, earlier]]);
    expect(stamps(rows.maintenanceItems)).toEqual([removed, removed]);
    expect(stamps(rows.maintenanceLogs)).toEqual([removed]);
    expect(stamps(rows.attachments)).toEqual([removed]);
    expect(stamps(rows.vehicleSpecs)).toEqual([removed]);
  });

  test("leaves the other vehicle's rows and the selection pointing to it untouched", async () => {
    const { a, b } = await seedTwo();
    const before = rowsOf(b);

    await removeVehicle(db, a);

    expect(rowsOf(b)).toEqual(before);
    expect(vehiclesQuery(db).all().map((v) => v.id)).toEqual([b]);
    expect(selectedVehicleIdQuery(db).all()).toEqual([{ value: b }]);
  });

  test('clears the selection when it pointed to the removed vehicle', async () => {
    const { b } = await seedTwo();

    await removeVehicle(db, b);

    expect(db.select().from(devicePrefs).all()).toEqual([]);
  });

  test('rejects an unknown or already removed vehicle without touching anything', async () => {
    const { a } = await seedTwo();
    await removeVehicle(db, a);
    jest.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    const before = rowsOf(a);

    await expectValidation(removeVehicle(db, 'nope'), 'Carro não encontrado.');
    await expectValidation(removeVehicle(db, a), 'Carro não encontrado.');

    expect(rowsOf(a)).toEqual(before);
  });

  test('rolls everything back when a step fails', async () => {
    const { a, b } = await seedTwo();
    const everything = () => ({ a: rowsOf(a), b: rowsOf(b), prefs: db.select().from(devicePrefs).all() });
    const before = everything();
    // Clearing the selection is the last step, so every soft delete before it must be undone.
    db.run(sql`CREATE TRIGGER fail_delete BEFORE DELETE ON device_prefs BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    await expect(removeVehicle(db, b)).rejects.toThrow('boom');

    expect(everything()).toEqual(before);
  });
});

test('allItemsQuery and allReadingsQuery span every vehicle except removed ones', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-01T10:00:00.000Z') });
  const a = await seedWithItems();
  db.update(maintenanceItems).set({ active: false }).where(eq(maintenanceItems.id, a.tiresId)).run();
  jest.setSystemTime(new Date('2026-10-01T10:00:01.000Z'));
  const b = await seedWithItems({ odometerKm: 30000 });
  db.update(maintenanceItems).set({ deletedAt: '2026-10-02T00:00:00.000Z' }).where(eq(maintenanceItems.id, b.tiresId)).run();
  await addOdometerReading(db, b.vehicleId, 31000, '2026-11-01', 'adjust');
  await removeVehicle(db, await seed({ odometerKm: 10000 }));
  // A vehicle deleted without its children (e.g. a future sync applying the vehicle row first) hides them too.
  const orphaned = await seed({ odometerKm: 20000 });
  db.update(vehicles).set({ deletedAt: '2026-10-02T00:00:00.000Z' }).where(eq(vehicles.id, orphaned)).run();

  expect(allItemsQuery(db).all()).toEqual([
    expect.objectContaining({ ...OIL, vehicleId: a.vehicleId, baselineKm: 50000, baselineDate: TODAY }),
    expect.objectContaining({ ...OIL, vehicleId: b.vehicleId, baselineKm: 30000 }),
  ]);
  expect(allReadingsQuery(db).all()).toEqual([
    { vehicleId: b.vehicleId, km: 30000, readAt: TODAY },
    { vehicleId: a.vehicleId, km: 50000, readAt: TODAY },
    { vehicleId: b.vehicleId, km: 31000, readAt: '2026-11-01' },
  ]);
});
