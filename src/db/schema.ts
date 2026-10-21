import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

const now = () => new Date().toISOString();

// Soft delete + timestamps on every table so v1 sync needs no schema migration.
const timestamps = {
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  deletedAt: text('deleted_at'),
};

export const vehicles = sqliteTable('vehicles', {
  id: text('id').primaryKey(),
  vehicleType: text('vehicle_type').notNull().default('car'),
  modelRef: text('model_ref'),
  nickname: text('nickname').notNull(),
  plate: text('plate'),
  vin: text('vin'),
  monthlyKmEstimate: integer('monthly_km_estimate').notNull(),
  severeUse: integer('severe_use', { mode: 'boolean' }).notNull().default(false),
  ...timestamps,
});

export const odometerReadings = sqliteTable(
  'odometer_readings',
  {
    id: text('id').primaryKey(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    km: integer('km').notNull(),
    readAt: text('read_at').notNull(),
    source: text('source', { enum: ['onboarding', 'adjust', 'log'] }).notNull(),
    // The log this reading came with, so editing or removing the log carries its reading along.
    logId: text('log_id').references((): AnySQLiteColumn => maintenanceLogs.id),
    ...timestamps,
  },
  (t) => [index('odometer_readings_vehicle_read_at_idx').on(t.vehicleId, t.readAt)],
);

export const maintenanceItems = sqliteTable(
  'maintenance_items',
  {
    id: text('id').primaryKey(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    templateKey: text('template_key'),
    name: text('name').notNull(),
    intervalKm: integer('interval_km'),
    intervalMonths: integer('interval_months'),
    baselineKm: integer('baseline_km').notNull(),
    baselineDate: text('baseline_date').notNull(),
    // The marco zero, so removing every log brings the baseline back to it. Null on items created
    // before these columns existed: those started at their car's onboarding reading.
    startKm: integer('start_km'),
    startDate: text('start_date'),
    snoozedUntil: text('snoozed_until'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    ...timestamps,
  },
  (t) => [
    check(
      'maintenance_items_interval_check',
      sql`${t.intervalKm} IS NOT NULL OR ${t.intervalMonths} IS NOT NULL`,
    ),
  ],
);

export const maintenanceLogs = sqliteTable(
  'maintenance_logs',
  {
    id: text('id').primaryKey(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    itemId: text('item_id').references(() => maintenanceItems.id),
    performedAt: text('performed_at').notNull(),
    km: integer('km').notNull(),
    costCents: integer('cost_cents'),
    brandSpec: text('brand_spec'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('maintenance_logs_vehicle_performed_at_idx').on(t.vehicleId, t.performedAt)],
);

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  logId: text('log_id')
    .notNull()
    .references(() => maintenanceLogs.id),
  filePath: text('file_path').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  remotePath: text('remote_path'),
  ...timestamps,
});

export const vehicleSpecs = sqliteTable('vehicle_specs', {
  vehicleId: text('vehicle_id')
    .primaryKey()
    .references(() => vehicles.id),
  oilSpec: text('oil_spec'),
  tireFrontPsi: integer('tire_front_psi'),
  tireRearPsi: integer('tire_rear_psi'),
  wiperDriver: text('wiper_driver'),
  wiperPassenger: text('wiper_passenger'),
  battery: text('battery'),
  ...timestamps,
});

// Device-local UI state (e.g. the open car). Never synced: v1 sync must skip this table,
// which is why it has no createdAt/deletedAt and rows are hard-deleted.
export const devicePrefs = sqliteTable('device_prefs', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamps.updatedAt,
});

// Device-local sync bookkeeping, never synced: each row's updated_at as last sent to or received
// from the cloud. A row whose updated_at differs is waiting to upload. Comparing for a difference
// rather than "newer than a cursor" keeps a phone clock running late from hiding edits.
export const syncState = sqliteTable(
  'sync_state',
  {
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    syncedUpdatedAt: text('synced_updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tableName, t.rowId] })],
);
