CREATE TABLE `round_settlements` (
	`scope` text NOT NULL,
	`client_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`event_id` text NOT NULL,
	`fact_hash` text NOT NULL,
	`run_id` text NOT NULL,
	`round_attempt_id` text NOT NULL,
	`mode` text NOT NULL,
	`rules_version` text NOT NULL,
	`score_model_version` text NOT NULL,
	`round_no` integer NOT NULL,
	`legal` integer NOT NULL,
	`passed` integer NOT NULL,
	`result_type` text NOT NULL,
	`shape` text,
	`process_score` integer NOT NULL,
	`win_score` integer NOT NULL,
	`penalty_score` integer NOT NULL,
	`round_score` integer NOT NULL,
	`round_start_score` integer NOT NULL,
	`cumulative_before` integer NOT NULL,
	`cumulative_after` integer NOT NULL,
	`target_score` integer NOT NULL,
	`record_quality` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	`received_at` text NOT NULL,
	PRIMARY KEY(`scope`, `client_id`, `settlement_id`),
	FOREIGN KEY (`client_id`) REFERENCES `analytics_clients`(`client_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "round_settlements_positive_parts" CHECK("round_settlements"."process_score" >= 0 AND "round_settlements"."win_score" >= 0 AND "round_settlements"."penalty_score" >= 0 AND "round_settlements"."target_score" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `round_settlements_round` ON `round_settlements` (`scope`,`client_id`,`round_attempt_id`,`rules_version`,`score_model_version`);--> statement-breakpoint
CREATE INDEX `round_settlements_report` ON `round_settlements` (`scope`,`mode`,`rules_version`,`score_model_version`,`record_quality`);--> statement-breakpoint
CREATE TABLE `settlement_patterns` (
	`scope` text NOT NULL,
	`client_id` text NOT NULL,
	`settlement_id` text NOT NULL,
	`pattern_id` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`scope`, `client_id`, `settlement_id`, `pattern_id`),
	FOREIGN KEY (`scope`,`client_id`,`settlement_id`) REFERENCES `round_settlements`(`scope`,`client_id`,`settlement_id`) ON UPDATE no action ON DELETE cascade
);
