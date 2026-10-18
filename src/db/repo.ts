import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  min,
  ne,
  sql,
} from 'drizzle-orm';
import {
  checkReading,
  findModel,
  MAX_KM,
  modelSpecs,
  READING_ERRORS,
  ValidationError,
  type ISODate,
} from '@/domain';
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
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
    Number.isNaN(t) ||
    new Date(t).toISOString().slice(0, 10) !== d
  ) {
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
  return db
    .select({ value: devicePrefs.value })
    .from(devicePrefs)
    .where(eq(devicePrefs.key, SELECTED_VEHICLE));
}

/** One row once the reminder prompt was answered (either way), so it's never shown again. */
export function notificationPromptQuery(db: Db) {
  return db
    .select({ value: devicePrefs.value })
    .from(devicePrefs)
    .where(eq(devicePrefs.key, NOTIFICATION_PROMPT));
}

// useLiveQuery only watches the FROM table, not joined ones; removeVehicle soft-deletes the
// vehicle's items and readings too, so a removal still refreshes these two.

export function allItemsQuery(db: Db) {
  return db
    .select(getTableColumns(maintenanceItems))
    .from(maintenanceItems)
    .innerJoin(vehicles, eq(maintenanceItems.vehicleId, vehicles.id))
    .where(
      and(
        eq(maintenanceItems.active, true),
        isNull(maintenanceItems.deletedAt),
        isNull(vehicles.deletedAt),
      ),
    )
    .orderBy(asc(maintenanceItems.createdAt));
}

export function allReadingsQuery(db: Db) {
  return db
    .select({
      vehicleId: odometerReadings.vehicleId,
      km: odometerReadings.km,
      readAt: odometerReadings.readAt,
    })
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
  // useLiveQuery only watches maintenance_logs: a photo only changes through updateMaintenance or
  // removeMaintenance, which also write the log row.
  // shortcut: an item rename won't refresh itemName until a log changes; fine while items can't be renamed.
  return (
    db
      .select({
        ...getTableColumns(maintenanceLogs),
        itemName: maintenanceItems.name,
        // File of the receipt photo (at most one live per log), or null.
        photo: sql<
          string | null
        >`(SELECT ${attachments.filePath} FROM ${attachments} WHERE ${attachments.logId} = ${maintenanceLogs.id} AND ${attachments.deletedAt} IS NULL LIMIT 1)`,
      })
      .from(maintenanceLogs)
      // No deletedAt filter on the item: history keeps the name of a removed item.
      .leftJoin(maintenanceItems, eq(maintenanceLogs.itemId, maintenanceItems.id))
      .where(and(eq(maintenanceLogs.vehicleId, vehicleId), isNull(maintenanceLogs.deletedAt)))
      .orderBy(desc(maintenanceLogs.performedAt), desc(maintenanceLogs.createdAt))
  );
}

/** Files of removed photos, which may still be on disk (see deleteRemovedPhotos). */
export function removedAttachmentsQuery(db: Db) {
  return db
    .select({ filePath: attachments.filePath })
    .from(attachments)
    .where(isNotNull(attachments.deletedAt));
}

export function specsQuery(db: Db, vehicleId: string) {
  return db
    .select()
    .from(vehicleSpecs)
    .where(and(eq(vehicleSpecs.vehicleId, vehicleId), isNull(vehicleSpecs.deletedAt)));
}

// --- Writes ---

/** `exceptId`: a reading being moved, checked against the others only. */
function assertReading(db: Db, vehicleId: string, km: number, readAt: ISODate, exceptId?: string) {
  const readings = db
    .select({ km: odometerReadings.km, readAt: odometerReadings.readAt })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, vehicleId),
        isNull(odometerReadings.deletedAt),
        exceptId ? ne(odometerReadings.id, exceptId) : undefined,
      ),
    )
    .all();
  const check = checkReading(readings, km, readAt);
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

export async function renameVehicle(db: Db, vehicleId: string, nickname: string): Promise<void> {
  const name = requiredText(nickname, 'Informe um apelido para o veículo.');
  db.transaction((tx) => {
    assertVehicle(tx, vehicleId);
    tx.update(vehicles).set({ nickname: name }).where(eq(vehicles.id, vehicleId)).run();
  });
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
    const logIds = tx
      .select({ id: maintenanceLogs.id })
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.vehicleId, vehicleId));
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
    /** A seed model id; its specs fill the car's cola de bolso. */
    modelRef?: string | null;
    items: {
      templateKey: string | null;
      name: string;
      intervalKm: number | null;
      intervalMonths: number | null;
    }[];
  },
  today: ISODate,
): Promise<string> {
  const nickname = requiredText(input.nickname, 'Informe um apelido para o veículo.');
  odometerKm(input.odometerKm);
  nonNegativeInt(input.monthlyKmEstimate, 'Estimativa de km por mês inválida.');
  isoDate(today);
  const model = input.modelRef ? findModel(input.modelRef) : undefined;
  if (input.modelRef && !model) throw new ValidationError('Modelo não encontrado.');
  const vehicleId = uuidv7();
  const items = input.items.map((item) => {
    if (item.intervalKm === null && item.intervalMonths === null) {
      throw new ValidationError('Informe um intervalo em km ou em meses.');
    }
    for (const n of [item.intervalKm, item.intervalMonths]) {
      if (n !== null && (!Number.isInteger(n) || n <= 0))
        throw new ValidationError('Intervalo inválido.');
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
      startKm: input.odometerKm,
      startDate: today,
    };
  });

  db.transaction((tx) => {
    tx.insert(vehicles)
      .values({
        id: vehicleId,
        modelRef: model?.id ?? null,
        nickname,
        monthlyKmEstimate: input.monthlyKmEstimate,
        severeUse: input.severeUse,
      })
      .run();
    tx.insert(odometerReadings)
      .values({
        id: uuidv7(),
        vehicleId,
        km: input.odometerKm,
        readAt: today,
        source: 'onboarding',
      })
      .run();
    if (items.length > 0) tx.insert(maintenanceItems).values(items).run();
    // Copied, not merged on read: what the user edits (even a cleared value) is the whole truth and
    // every reader stays one plain query.
    // shortcut: a seed fix only reaches new cars; when one matters, update the rows still holding the old value.
    tx.insert(vehicleSpecs)
      .values({ vehicleId, ...(model && modelSpecs(model)) })
      .run();
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
      // Logs keep their typed km: changing what the user wrote is left to editing the log in history.
    }
    // Still throws above_next with correct (rolling the correction back): later readings aren't overridden.
    assertReading(tx, vehicleId, km, readAt);
    tx.insert(odometerReadings).values({ id: uuidv7(), vehicleId, km, readAt, source }).run();
  });
}

/** An encrypted file already on disk (see @/attachments), recorded with its log. */
export type NewAttachment = { filePath: string; mime: string; sizeBytes: number };

type LogFields = {
  performedAt: ISODate;
  km: number;
  costCents?: number | null;
  brandSpec?: string | null;
  notes?: string | null;
};

function logFields(input: LogFields) {
  odometerKm(input.km);
  isoDate(input.performedAt);
  if (input.costCents != null) nonNegativeInt(input.costCents, 'Valor inválido.');
  return {
    performedAt: input.performedAt,
    km: input.km,
    costCents: input.costCents ?? null,
    brandSpec: optionalText(input.brandSpec),
    notes: optionalText(input.notes),
  };
}

export async function registerMaintenance(
  db: Db,
  input: LogFields & {
    vehicleId: string;
    itemId: string | null;
    attachment?: NewAttachment | null;
  },
): Promise<void> {
  const { vehicleId, itemId } = input;
  const fields = logFields(input);
  const { km, performedAt } = fields;

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

    const logId = uuidv7();
    tx.insert(maintenanceLogs)
      .values({ id: logId, vehicleId, itemId, ...fields })
      .run();
    tx.insert(odometerReadings)
      .values({ id: uuidv7(), vehicleId, km, readAt: performedAt, source: 'log', logId })
      .run();
    if (input.attachment)
      tx.insert(attachments)
        .values({ id: uuidv7(), logId, ...input.attachment })
        .run();

    // A retroactive log (older than the baseline) stays in history but must not move the baseline.
    if (item && performedAt >= item.baselineDate) {
      tx.update(maintenanceItems)
        .set({ baselineKm: km, baselineDate: performedAt, snoozedUntil: null })
        .where(eq(maintenanceItems.id, item.id))
        .run();
    }
  });
}

/**
 * `attachment`: leave it out to keep the photo, null removes it, a new one replaces it. Removed
 * photos stay on disk until deleteRemovedPhotos (@/attachments) runs.
 */
export async function updateMaintenance(
  db: Db,
  logId: string,
  input: LogFields & { attachment?: NewAttachment | null },
): Promise<void> {
  const fields = logFields(input);
  const { km, performedAt } = fields;

  db.transaction((tx) => {
    const log = liveLog(tx, logId);
    // Only a moved reading is checked again: one already dropped by a correction in Ajustar KM
    // stays dropped while just the cost or notes change.
    if (km !== log.km || performedAt !== log.performedAt) {
      const reading = logReading(tx, log);
      assertReading(tx, log.vehicleId, km, performedAt, reading?.id);
      if (reading) {
        tx.update(odometerReadings)
          .set({ km, readAt: performedAt, logId, deletedAt: null })
          .where(eq(odometerReadings.id, reading.id))
          .run();
      } else {
        tx.insert(odometerReadings)
          .values({
            id: uuidv7(),
            vehicleId: log.vehicleId,
            km,
            readAt: performedAt,
            source: 'log',
            logId,
          })
          .run();
      }
    }
    tx.update(maintenanceLogs).set(fields).where(eq(maintenanceLogs.id, logId)).run();
    if (input.attachment !== undefined) {
      const now = new Date().toISOString();
      tx.update(attachments)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(attachments.logId, logId), isNull(attachments.deletedAt)))
        .run();
      if (input.attachment)
        tx.insert(attachments)
          .values({ id: uuidv7(), logId, ...input.attachment })
          .run();
    }
    if (log.itemId) rebase(tx, log.itemId);
  });
}

/** Soft-deletes the log with its reading and photo. The photo file stays until deleteRemovedPhotos runs. */
export async function removeMaintenance(db: Db, logId: string): Promise<void> {
  db.transaction((tx) => {
    const log = liveLog(tx, logId);
    const now = new Date().toISOString();
    const gone = { deletedAt: now, updatedAt: now };
    tx.update(maintenanceLogs).set(gone).where(eq(maintenanceLogs.id, logId)).run();
    const reading = logReading(tx, log);
    if (reading && !reading.deletedAt) {
      tx.update(odometerReadings).set(gone).where(eq(odometerReadings.id, reading.id)).run();
    }
    tx.update(attachments)
      .set(gone)
      .where(and(eq(attachments.logId, logId), isNull(attachments.deletedAt)))
      .run();
    if (log.itemId) rebase(tx, log.itemId);
  });
}

function liveLog(tx: Db, logId: string) {
  const log = tx
    .select()
    .from(maintenanceLogs)
    .where(and(eq(maintenanceLogs.id, logId), isNull(maintenanceLogs.deletedAt)))
    .get();
  if (!log) throw new ValidationError('Registro não encontrado.');
  return log;
}

function logReading(tx: Db, log: typeof maintenanceLogs.$inferSelect) {
  const cols = { id: odometerReadings.id, deletedAt: odometerReadings.deletedAt };
  return (
    tx.select(cols).from(odometerReadings).where(eq(odometerReadings.logId, log.id)).get() ??
    // Logs saved before readings were linked (migration 0002) find theirs by value.
    tx
      .select(cols)
      .from(odometerReadings)
      .where(
        and(
          isNull(odometerReadings.logId),
          eq(odometerReadings.vehicleId, log.vehicleId),
          eq(odometerReadings.source, 'log'),
          eq(odometerReadings.km, log.km),
          eq(odometerReadings.readAt, log.performedAt),
          isNull(odometerReadings.deletedAt),
        ),
      )
      .get()
  );
}

/** Points the item's baseline at its latest log since the marco zero, or back at the marco zero. */
function rebase(tx: Db, itemId: string) {
  const item = tx.select().from(maintenanceItems).where(eq(maintenanceItems.id, itemId)).get();
  if (!item) return;
  const start =
    item.startKm !== null && item.startDate !== null
      ? { km: item.startKm, date: item.startDate }
      : // Items created before the start columns existed began at their car's onboarding reading.
        tx
          .select({ km: odometerReadings.km, date: odometerReadings.readAt })
          .from(odometerReadings)
          .where(
            and(
              eq(odometerReadings.vehicleId, item.vehicleId),
              eq(odometerReadings.source, 'onboarding'),
            ),
          )
          .get();
  if (!start) return;
  const last = tx
    .select({ km: maintenanceLogs.km, date: maintenanceLogs.performedAt })
    .from(maintenanceLogs)
    .where(
      and(
        eq(maintenanceLogs.itemId, itemId),
        isNull(maintenanceLogs.deletedAt),
        gte(maintenanceLogs.performedAt, start.date),
      ),
    )
    .orderBy(desc(maintenanceLogs.performedAt), desc(maintenanceLogs.createdAt))
    .get();
  const base = last ?? start;
  // As in a correction in Ajustar KM: a maintenance can't have happened above a later real reading.
  const later = tx
    .select({ km: min(odometerReadings.km) })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, item.vehicleId),
        isNull(odometerReadings.deletedAt),
        gte(odometerReadings.readAt, base.date),
      ),
    )
    .get()?.km;
  const baselineKm = later != null ? Math.min(base.km, later) : base.km;
  if (baselineKm === item.baselineKm && base.date === item.baselineDate) return;
  tx.update(maintenanceItems)
    .set({ baselineKm, baselineDate: base.date })
    .where(eq(maintenanceItems.id, itemId))
    .run();
}

export async function setSnooze(db: Db, itemId: string, until: ISODate | null): Promise<void> {
  if (until !== null) isoDate(until);
  db.update(maintenanceItems)
    .set({ snoozedUntil: until })
    .where(and(eq(maintenanceItems.id, itemId), isNull(maintenanceItems.deletedAt)))
    .run();
}

// --- Backup ---

// Insert order: every table after the ones it references.
const BACKUP_TABLES = {
  vehicles,
  maintenanceItems,
  maintenanceLogs,
  odometerReadings,
  attachments,
  vehicleSpecs,
} as const;

export type BackupRows = {
  [K in keyof typeof BACKUP_TABLES]: (typeof BACKUP_TABLES)[K]['$inferSelect'][];
};

/** Every synced row, soft-deleted ones included: v1 sync needs to know what went away. */
export function backupRows(db: Db): BackupRows {
  const rows = {} as Record<string, unknown[]>;
  for (const [name, table] of Object.entries(BACKUP_TABLES))
    rows[name] = db.select().from(table).all();
  return rows as BackupRows;
}

/** Replaces all local data with a backup's, in one transaction. The caller confirms first. */
export async function replaceAllData(db: Db, rows: BackupRows): Promise<void> {
  const entries = Object.entries(BACKUP_TABLES) as [
    keyof BackupRows,
    (typeof BACKUP_TABLES)[keyof BackupRows],
  ][];
  db.transaction((tx) => {
    for (const [, table] of [...entries].reverse()) tx.delete(table).run();
    for (const [name, table] of entries) {
      const list = rows[name];
      if (!Array.isArray(list))
        throw new ValidationError('Este arquivo não é um backup do Garagem.');
      // SQLite caps bound parameters per statement (999 on older builds): 50 rows of ≤ 15 columns fit.
      for (let i = 0; i < list.length; i += 50)
        tx.insert(table)
          .values(list.slice(i, i + 50))
          .run();
    }
    tx.delete(devicePrefs).where(eq(devicePrefs.key, SELECTED_VEHICLE)).run();
  });
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
