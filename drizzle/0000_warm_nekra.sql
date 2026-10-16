CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`log_id` text NOT NULL,
	`file_path` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`remote_path` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`log_id`) REFERENCES `maintenance_logs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `maintenance_items` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`template_key` text,
	`name` text NOT NULL,
	`interval_km` integer,
	`interval_months` integer,
	`baseline_km` integer NOT NULL,
	`baseline_date` text NOT NULL,
	`snoozed_until` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "maintenance_items_interval_check" CHECK("maintenance_items"."interval_km" IS NOT NULL OR "maintenance_items"."interval_months" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE `maintenance_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`item_id` text,
	`performed_at` text NOT NULL,
	`km` integer NOT NULL,
	`cost_cents` integer,
	`brand_spec` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `maintenance_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `maintenance_logs_vehicle_performed_at_idx` ON `maintenance_logs` (`vehicle_id`,`performed_at`);--> statement-breakpoint
CREATE TABLE `odometer_readings` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_id` text NOT NULL,
	`km` integer NOT NULL,
	`read_at` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `odometer_readings_vehicle_read_at_idx` ON `odometer_readings` (`vehicle_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `vehicle_specs` (
	`vehicle_id` text PRIMARY KEY NOT NULL,
	`oil_spec` text,
	`tire_front_psi` integer,
	`tire_rear_psi` integer,
	`wiper_driver` text,
	`wiper_passenger` text,
	`battery` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` text PRIMARY KEY NOT NULL,
	`vehicle_type` text DEFAULT 'car' NOT NULL,
	`model_ref` text,
	`nickname` text NOT NULL,
	`plate` text,
	`vin` text,
	`monthly_km_estimate` integer NOT NULL,
	`severe_use` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
