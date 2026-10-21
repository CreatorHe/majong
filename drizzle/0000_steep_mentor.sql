CREATE TABLE `analytics_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`quota_window` integer DEFAULT 0 NOT NULL,
	`quota_count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "analytics_clients_scope" CHECK("analytics_clients"."scope" IN ('production', 'sandbox'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `analytics_clients_token_hash_unique` ON `analytics_clients` (`token_hash`);--> statement-breakpoint
CREATE TABLE `completed_hands` (
	`scope` text NOT NULL,
	`client_id` text NOT NULL,
	`hand_id` text NOT NULL,
	`event_id` text NOT NULL,
	`fact_hash` text NOT NULL,
	`run_id` text NOT NULL,
	`round_attempt_id` text NOT NULL,
	`mode` text NOT NULL,
	`rules_version` text NOT NULL,
	`score_model_version` text NOT NULL,
	`shape` text NOT NULL,
	`round_no` integer NOT NULL,
	`round_score` integer NOT NULL,
	`target_score` integer NOT NULL,
	`passed` integer NOT NULL,
	`record_quality` text NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	PRIMARY KEY(`scope`, `client_id`, `hand_id`),
	FOREIGN KEY (`client_id`) REFERENCES `analytics_clients`(`client_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "completed_hands_scores" CHECK("completed_hands"."round_score" >= 0 AND "completed_hands"."target_score" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `completed_hands_round` ON `completed_hands` (`scope`,`client_id`,`round_attempt_id`,`rules_version`,`score_model_version`);--> statement-breakpoint
CREATE INDEX `completed_hands_report` ON `completed_hands` (`scope`,`mode`,`rules_version`,`score_model_version`,`record_quality`);--> statement-breakpoint
CREATE TABLE `hand_patterns` (
	`scope` text NOT NULL,
	`client_id` text NOT NULL,
	`hand_id` text NOT NULL,
	`pattern_id` text NOT NULL,
	PRIMARY KEY(`scope`, `client_id`, `hand_id`, `pattern_id`),
	FOREIGN KEY (`scope`,`client_id`,`hand_id`) REFERENCES `completed_hands`(`scope`,`client_id`,`hand_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `hand_patterns_pattern` ON `hand_patterns` (`pattern_id`);--> statement-breakpoint
CREATE TABLE `raw_events` (
	`scope` text NOT NULL,
	`client_id` text NOT NULL,
	`event_id` text NOT NULL,
	`event_name` text NOT NULL,
	`schema_version` integer NOT NULL,
	`event_hash` text NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	`session_id` text NOT NULL,
	`app_release` text NOT NULL,
	`rules_version` text NOT NULL,
	`score_model_version` text NOT NULL,
	`mode` text,
	`run_id` text,
	`round_attempt_id` text,
	`hand_id` text,
	`payload_json` text NOT NULL,
	PRIMARY KEY(`scope`, `client_id`, `event_id`),
	FOREIGN KEY (`client_id`) REFERENCES `analytics_clients`(`client_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `raw_events_received` ON `raw_events` (`received_at`);