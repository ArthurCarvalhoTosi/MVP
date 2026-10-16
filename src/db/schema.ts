import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
    vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
    km: integer('km').notNull(),
    readAt: text('read_at').notNull(),
    source: text('source', { enum: ['onboarding', 'adjust', 'log'] }).notNull(),
    ...timestamps,
  },
  (t) => [index('odometer_readings_vehicle_read_at_idx').on(t.vehicleId, t.readAt)],
);

export const maintenanceItems = sqliteTable(
  'maintenance_items',
  {
    id: text('id').primaryKey(),
    vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
    templateKey: text('template_key'),
    name: text('name').notNull(),
    intervalKm: integer('interval_km'),
    intervalMonths: integer('interval_months'),
    baselineKm: integer('baseline_km').notNull(),
    baselineDate: text('baseline_date').notNull(),
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
    vehicleId: text('vehicle_id').notNull().references(() => vehicles.id),
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
  logId: text('log_id').notNull().references(() => maintenanceLogs.id),
  filePath: text('file_path').notNull(),
  mime: text('mime').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  remotePath: text('remote_path'),
  ...timestamps,
});

export const vehicleSpecs = sqliteTable('vehicle_specs', {
  vehicleId: text('vehicle_id').primaryKey().references(() => vehicles.id),
  oilSpec: text('oil_spec'),
  tireFrontPsi: integer('tire_front_psi'),
  tireRearPsi: integer('tire_rear_psi'),
  wiperDriver: text('wiper_driver'),
  wiperPassenger: text('wiper_passenger'),
  battery: text('battery'),
  ...timestamps,
});
