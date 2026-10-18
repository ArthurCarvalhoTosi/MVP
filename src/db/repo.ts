import { and, asc, desc, eq, getTableColumns, gt, inArray, isNull, lte } from 'drizzle-orm';
import { checkReading, MAX_KM, READING_ERRORS, ValidationError, type ISODate } from '@/domain';
import type { Db } from './client';
import { uuidv7 } from './id';
import {
  attachments,
  devicePrefs,
  maintenanceItems,
  maintenanceLogs,
  odometerReadings,
  vehicleSpecs,
  vehicles,
} from './schema';

const SELECTED_VEHICLE = 'selectedVehicleId';
const NOTIFICATION_PROMPT = 'notificationPromptAnswered';

// updatedAt is refreshed on every update by $onUpdateFn in schema.ts.

export class OdometerError extends ValidationError {
  constructor(public check: 'below_previous' | 'above_next') {
    super(READING_ERRORS[check]);
  }
}

// --- Input validation ---

function nonNegativeInt(n: number, message: string) {
  if (!Number.isInteger(n) || n < 0) throw new ValidationError(message);
}

function odometerKm(n: number) {
  nonNegativeInt(n, 'Quilometragem inválida.');
  if (n > MAX_KM) throw new ValidationError('Quilometragem inválida.');
}

function requiredText(s: string, message: string): string {
  const t = s.trim();
  if (!t) throw new ValidationError(message);
  return t;
}

function isoDate(d: string) {
  const t = Date.parse(`${d}T00:00:00Z`);
  // Round trip rejects shapes that parse but roll over, like 2026-02-30.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) {
    throw new ValidationError('Data inválida.');
  }
}

function optionalText(s: string | null | undefined): string | null {
  return s?.trim() || null;
}

// --- Live-queryable reads (soft-deleted rows excluded) ---

export function vehiclesQuery(db: Db) {
  return db
    .select()
    .from(vehicles)
    .where(isNull(vehicles.deletedAt))
    .orderBy(asc(vehicles.createdAt), asc(vehicles.id));
}

export function selectedVehicleIdQuery(db: Db) {
  return db.select({ value: devicePrefs.value }).from(devicePrefs).where(eq(devicePrefs.key, SELECTED_VEHICLE));
}

/** One row once the reminder prompt was answered (either way), so it's never shown again. */
export function notificationPromptQuery(db: Db) {
  return db.select({ value: devicePrefs.value }).from(devicePrefs).where(eq(devicePrefs.key, NOTIFICATION_PROMPT));
}

// useLiveQuery only watches the FROM table, not joined ones; removeVehicle soft-deletes the
// vehicle's items and readings too, so a removal still refreshes these two.

export function allItemsQuery(db: Db) {
  return db
    .select(getTableColumns(maintenanceItems))
    .from(maintenanceItems)
    .innerJoin(vehicles, eq(maintenanceItems.vehicleId, vehicles.id))
    .where(and(eq(maintenanceItems.active, true), isNull(maintenanceItems.deletedAt), isNull(vehicles.deletedAt)))
    .orderBy(asc(maintenanceItems.createdAt));
}

export function allReadingsQuery(db: Db) {
  return db
    .select({ vehicleId: odometerReadings.vehicleId, km: odometerReadings.km, readAt: odometerReadings.readAt })
    .from(odometerReadings)
    .innerJoin(vehicles, eq(odometerReadings.vehicleId, vehicles.id))
    .where(and(isNull(odometerReadings.deletedAt), isNull(vehicles.deletedAt)))
    .orderBy(asc(odometerReadings.readAt), asc(odometerReadings.km));
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

function assertVehicle(db: Db, vehicleId: string) {
  const found = db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), isNull(vehicles.deletedAt)))
    .get();
  if (!found) throw new ValidationError('Carro não encontrado.');
}

function setSelectedVehicle(db: Db, vehicleId: string) {
  db.insert(devicePrefs)
    .values({ key: SELECTED_VEHICLE, value: vehicleId })
    .onConflictDoUpdate({ target: devicePrefs.key, set: { value: vehicleId } })
    .run();
}

export async function answerNotificationPrompt(db: Db): Promise<void> {
  db.insert(devicePrefs)
    .values({ key: NOTIFICATION_PROMPT, value: 'yes' })
    .onConflictDoNothing({ target: devicePrefs.key })
    .run();
}

export async function selectVehicle(db: Db, vehicleId: string): Promise<void> {
  assertVehicle(db, vehicleId);
  setSelectedVehicle(db, vehicleId);
}

export async function removeVehicle(db: Db, vehicleId: string): Promise<void> {
  db.transaction((tx) => {
    assertVehicle(tx, vehicleId);
    const now = new Date().toISOString();
    const gone = { deletedAt: now, updatedAt: now };
    tx.update(vehicles).set(gone).where(eq(vehicles.id, vehicleId)).run();
    // Rows deleted earlier keep their own deletedAt, so sync sees when each one really went away.
    for (const t of [odometerReadings, maintenanceItems, maintenanceLogs, vehicleSpecs]) {
      tx.update(t)
        .set(gone)
        .where(and(eq(t.vehicleId, vehicleId), isNull(t.deletedAt)))
        .run();
    }
    const logIds = tx.select({ id: maintenanceLogs.id }).from(maintenanceLogs).where(eq(maintenanceLogs.vehicleId, vehicleId));
    tx.update(attachments)
      .set(gone)
      .where(and(inArray(attachments.logId, logIds), isNull(attachments.deletedAt)))
      .run();
    tx.delete(devicePrefs)
      .where(and(eq(devicePrefs.key, SELECTED_VEHICLE), eq(devicePrefs.value, vehicleId)))
      .run();
  });
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
  odometerKm(input.odometerKm);
  nonNegativeInt(input.monthlyKmEstimate, 'Estimativa de km por mês inválida.');
  isoDate(today);
  const vehicleId = uuidv7();
  const items = input.items.map((item) => {
    if (item.intervalKm === null && item.intervalMonths === null) {
      throw new ValidationError('Informe um intervalo em km ou em meses.');
    }
    for (const n of [item.intervalKm, item.intervalMonths]) {
      if (n !== null && (!Number.isInteger(n) || n <= 0)) throw new ValidationError('Intervalo inválido.');
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
    setSelectedVehicle(tx, vehicleId);
  });
  return vehicleId;
}

export async function addOdometerReading(
  db: Db,
  vehicleId: string,
  km: number,
  readAt: ISODate,
  source: 'adjust' | 'log',
  opts: { correct?: boolean } = {},
): Promise<void> {
  odometerKm(km);
  isoDate(readAt);
  db.transaction((tx) => {
    // The panel shows the real km: earlier readings above it were overestimates (e.g. a log that
    // accepted the projection) and give way to it.
    if (opts.correct && source === 'adjust') {
      const now = new Date().toISOString();
      tx.update(odometerReadings)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            eq(odometerReadings.vehicleId, vehicleId),
            isNull(odometerReadings.deletedAt),
            lte(odometerReadings.readAt, readAt),
            gt(odometerReadings.km, km),
          ),
        )
        .run();
      // A maintenance can't have happened above today's real km; clamping errs toward an earlier due date.
      tx.update(maintenanceItems)
        .set({ baselineKm: km })
        .where(
          and(
            eq(maintenanceItems.vehicleId, vehicleId),
            isNull(maintenanceItems.deletedAt),
            gt(maintenanceItems.baselineKm, km),
          ),
        )
        .run();
      // shortcut: logs keep their typed km; editing a log comes with history editing.
    }
    // Still throws above_next with correct (rolling the correction back): later readings aren't overridden.
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
  odometerKm(km);
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
    if (itemId && !item) throw new ValidationError('Item de manutenção não encontrado.');

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
