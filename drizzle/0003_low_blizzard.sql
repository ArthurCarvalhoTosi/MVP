CREATE TABLE `sync_state` (
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`synced_updated_at` text NOT NULL,
	PRIMARY KEY(`table_name`, `row_id`)
);
