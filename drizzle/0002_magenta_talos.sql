ALTER TABLE `maintenance_items` ADD `start_km` integer;--> statement-breakpoint
ALTER TABLE `maintenance_items` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `odometer_readings` ADD `log_id` text REFERENCES maintenance_logs(id);