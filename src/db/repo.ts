import { and, asc, desc, eq, getTableColumns, isNull } from 'drizzle-orm';
import { checkReading, type ISODate } from '@/domain';
import type { Db } from './client';
import { uuidv7 } from './id';
import { maintenanceItems, maintenanceLogs, odometerReadings, vehicleSpecs, vehicles } from './schema';

// updatedAt is refreshed on every update by $onUpdateFn in schema.ts.

export class OdometerError extends Error {
  constructor(public check: 'below_previous' | 'above_next') {
    super(
      check === 'below_previous'
        ? 'A quilometragem é menor que uma leitura anterior.'
        : 'A quilometragem é maior que uma leitura posterior.',
    );
  }
}

// --- Input validation (pt-BR messages surface in the UI) ---

function nonNegativeInt(n: number, message: string) {
  if (!Number.isInteger(n) || n < 0) throw new Error(message);
}

function requiredText(s: string, message: string): string {
  const t = s.trim();
  if (!t) throw new Error(message);
  return t;
}

function isoDate(d: string) {
  const t = Date.parse(`${d}T00:00:00Z`);
  // Round trip rejects shapes that parse but roll over, like 2026-02-30.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) {
    throw new Error('Data inválida.');
  }
}

function optionalText(s: string | null | undefined): string | null {
  return s?.trim() || null;
}

// --- Live-queryable reads (soft-deleted rows excluded) ---

export function vehicleQuery(db: Db) {
  // shortcut: single vehicle in the UI for MVP; schema already supports many.
  return db
    .select()
    .from(vehicles)
    .where(isNull(vehicles.deletedAt))
    .orderBy(asc(vehicles.createdAt))
    .limit(1);
}

export function readingsQuery(db: Db, vehicleId: string) {
  return db
    .select({ km: odometerReadings.km, readAt: odometerReadings.readAt })
    .from(odometerReadings)
    .where(and(eq(odometerReadings.vehicleId, vehicleId), isNull(odometerReadings.deletedAt)))
    .orderBy(asc(odometerReadings.readAt), asc(odometerReadings.km));
}

export function itemsQuery(db: Db, vehicleId: string) {
  return db
    .select()
    .from(maintenanceItems)
    .where(
      and(
        eq(maintenanceItems.vehicleId, vehicleId),
        eq(maintenanceItems.active, true),
        isNull(maintenanceItems.deletedAt),
      ),
    )
    .orderBy(asc(maintenanceItems.createdAt));
}

export function logsQuery(db: Db, vehicleId: string) {
  // shortcut: useLiveQuery only watches maintenance_logs, so an item rename won't refresh itemName
  // until a log changes; fine while items can't be renamed.
  return (
    db
      .select({ ...getTableColumns(maintenanceLogs), itemName: maintenanceItems.name })
      .from(maintenanceLogs)
      // No deletedAt filter on the item: history keeps the name of a removed item.
      .leftJoin(maintenanceItems, eq(maintenanceLogs.itemId, maintenanceItems.id))
      .where(and(eq(maintenanceLogs.vehicleId, vehicleId), isNull(maintenanceLogs.deletedAt)))
      .orderBy(desc(maintenanceLogs.performedAt), desc(maintenanceLogs.createdAt))
  );
}

export function specsQuery(db: Db, vehicleId: string) {
  return db
    .select()
    .from(vehicleSpecs)
    .where(and(eq(vehicleSpecs.vehicleId, vehicleId), isNull(vehicleSpecs.deletedAt)));
}

// --- Writes ---

function assertReading(db: Db, vehicleId: string, km: number, readAt: ISODate) {
  const check = checkReading(readingsQuery(db, vehicleId).all(), km, readAt);
  if (check !== 'ok') throw new OdometerError(check);
}

export async function createVehicle(
  db: Db,
  input: {
    nickname: string;
    odometerKm: number;
    monthlyKmEstimate: number;
    severeUse: boolean;
    items: { templateKey: string | null; name: string; intervalKm: number | null; intervalMonths: number | null }[];
  },
  today: ISODate,
): Promise<string> {
  const nickname = requiredText(input.nickname, 'Informe um apelido para o veículo.');
  nonNegativeInt(input.odometerKm, 'Quilometragem inválida.');
  nonNegativeInt(input.monthlyKmEstimate, 'Estimativa de km por mês inválida.');
  isoDate(today);
  const vehicleId = uuidv7();
  const items = input.items.map((item) => {
    if (item.intervalKm === null && item.intervalMonths === null) {
      throw new Error('Informe um intervalo em km ou em meses.');
    }
    for (const n of [item.intervalKm, item.intervalMonths]) {
      if (n !== null && (!Number.isInteger(n) || n <= 0)) throw new Error('Intervalo inválido.');
    }
    return {
      id: uuidv7(),
      vehicleId,
      templateKey: item.templateKey,
      name: requiredText(item.name, 'Informe o nome do item.'),
      intervalKm: item.intervalKm,
      intervalMonths: item.intervalMonths,
      baselineKm: input.odometerKm,
      baselineDate: today,
    };
  });

  db.transaction((tx) => {
    tx.insert(vehicles)
      .values({ id: vehicleId, nickname, monthlyKmEstimate: input.monthlyKmEstimate, severeUse: input.severeUse })
      .run();
    tx.insert(odometerReadings)
      .values({ id: uuidv7(), vehicleId, km: input.odometerKm, readAt: today, source: 'onboarding' })
      .run();
    if (items.length > 0) tx.insert(maintenanceItems).values(items).run();
    tx.insert(vehicleSpecs).values({ vehicleId }).run();
  });
  return vehicleId;
}

export async function addOdometerReading(
  db: Db,
  vehicleId: string,
  km: number,
  readAt: ISODate,
  source: 'adjust' | 'log',
): Promise<void> {
  nonNegativeInt(km, 'Quilometragem inválida.');
  isoDate(readAt);
  db.transaction((tx) => {
    assertReading(tx, vehicleId, km, readAt);
    tx.insert(odometerReadings).values({ id: uuidv7(), vehicleId, km, readAt, source }).run();
  });
}

export async function registerMaintenance(
  db: Db,
  input: {
    vehicleId: string;
    itemId: string | null;
    performedAt: ISODate;
    km: number;
    costCents?: number | null;
    brandSpec?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  const { vehicleId, itemId, performedAt, km } = input;
  nonNegativeInt(km, 'Quilometragem inválida.');
  isoDate(performedAt);
  if (input.costCents != null) nonNegativeInt(input.costCents, 'Valor inválido.');

  db.transaction((tx) => {
    assertReading(tx, vehicleId, km, performedAt);
    const item = itemId
      ? tx
          .select({ id: maintenanceItems.id, baselineDate: maintenanceItems.baselineDate })
          .from(maintenanceItems)
          .where(
            and(
              eq(maintenanceItems.id, itemId),
              eq(maintenanceItems.vehicleId, vehicleId),
              isNull(maintenanceItems.deletedAt),
            ),
          )
          .get()
      : undefined;
    if (itemId && !item) throw new Error('Item de manutenção não encontrado.');

    tx.insert(maintenanceLogs)
      .values({
        id: uuidv7(),
        vehicleId,
        itemId,
        performedAt,
        km,
        costCents: input.costCents ?? null,
        brandSpec: optionalText(input.brandSpec),
        notes: optionalText(input.notes),
      })
      .run();
    tx.insert(odometerReadings).values({ id: uuidv7(), vehicleId, km, readAt: performedAt, source: 'log' }).run();

    // A retroactive log (older than the baseline) stays in history but must not move the baseline.
    if (item && performedAt >= item.baselineDate) {
      tx.update(maintenanceItems)
        .set({ baselineKm: km, baselineDate: performedAt, snoozedUntil: null })
        .where(eq(maintenanceItems.id, item.id))
        .run();
    }
  });
}

export async function setSnooze(db: Db, itemId: string, until: ISODate | null): Promise<void> {
  if (until !== null) isoDate(until);
  db.update(maintenanceItems)
    .set({ snoozedUntil: until })
    .where(and(eq(maintenanceItems.id, itemId), isNull(maintenanceItems.deletedAt)))
    .run();
}

export async function upsertSpecs(
  db: Db,
  vehicleId: string,
  specs: Partial<{
    oilSpec: string | null;
    tireFrontPsi: number | null;
    tireRearPsi: number | null;
    wiperDriver: string | null;
    wiperPassenger: string | null;
    battery: string | null;
  }>,
): Promise<void> {
  for (const psi of [specs.tireFrontPsi, specs.tireRearPsi]) {
    if (psi != null) nonNegativeInt(psi, 'Calibragem inválida.');
  }
  db.insert(vehicleSpecs)
    .values({ vehicleId, ...specs })
    .onConflictDoUpdate({ target: vehicleSpecs.vehicleId, set: specs })
    .run();
}
