CREATE TABLE `completions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	`local_date` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`approved_by` text,
	`completed_at` integer NOT NULL,
	`undone_at` integer,
	`ledger_entry_id` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "completions_status_check" CHECK(status IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "completions_local_date_check" CHECK("completions"."local_date" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
);
--> statement-breakpoint
CREATE INDEX `completions_item_user_date_idx` ON `completions` (`item_id`,`user_id`,`local_date`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`push_token` text NOT NULL,
	`platform` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "devices_platform_check" CHECK(platform IN ('android', 'ios'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_push_token_uq` ON `devices` (`push_token`);--> statement-breakpoint
CREATE INDEX `devices_user_idx` ON `devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `households` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`week_start` integer DEFAULT 1 NOT NULL,
	`backdate_days` integer DEFAULT 2 NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	CONSTRAINT "households_week_start_check" CHECK("households"."week_start" BETWEEN 1 AND 7),
	CONSTRAINT "households_backdate_days_check" CHECK("households"."backdate_days" >= 0)
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`response` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_created_idx` ON `idempotency_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`role` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`used_by` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invites_role_check" CHECK(role IN ('owner', 'adult', 'child'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_token_hash_uq` ON `invites` (`token_hash`);--> statement-breakpoint
CREATE TABLE `item_assignees` (
	`item_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `user_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_assignees_user_idx` ON `item_assignees` (`user_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`schedule` text,
	`target_per_period` integer DEFAULT 1 NOT NULL,
	`reward` integer DEFAULT 0 NOT NULL,
	`credits_to` text DEFAULT 'personal' NOT NULL,
	`due_at` integer,
	`pinned` integer DEFAULT false NOT NULL,
	`requires_approval` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "items_kind_check" CHECK(kind IN ('habit', 'task')),
	CONSTRAINT "items_credits_to_check" CHECK(credits_to IN ('personal', 'shared')),
	CONSTRAINT "items_target_check" CHECK("items"."target_per_period" >= 1),
	CONSTRAINT "items_reward_check" CHECK("items"."reward" >= 0)
);
--> statement-breakpoint
CREATE INDEX `items_household_idx` ON `items` (`household_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`wallet_id` text NOT NULL,
	`amount` integer NOT NULL,
	`reason` text NOT NULL,
	`ref_id` text,
	`transfer_id` text,
	`note` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ledger_entries_reason_check" CHECK(reason IN ('completion', 'undo', 'redemption', 'transfer', 'adjustment')),
	CONSTRAINT "ledger_entries_amount_check" CHECK("ledger_entries"."amount" <> 0)
);
--> statement-breakpoint
CREATE INDEX `ledger_entries_wallet_created_idx` ON `ledger_entries` (`wallet_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ledger_entries_transfer_idx` ON `ledger_entries` (`transfer_id`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`household_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`can_create_items` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`household_id`, `user_id`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "memberships_role_check" CHECK(role IN ('owner', 'adult', 'child'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_user_uq` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE TABLE `oidc_states` (
	`state` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`invite_token` text,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `oidc_states_expires_idx` ON `oidc_states` (`expires_at`);--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`reward_id` text NOT NULL,
	`user_id` text NOT NULL,
	`wallet_id` text NOT NULL,
	`redeemed_at` integer NOT NULL,
	`ledger_entry_id` text NOT NULL,
	FOREIGN KEY (`reward_id`) REFERENCES `rewards`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_entry_id`) REFERENCES `ledger_entries`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `redemptions_reward_user_idx` ON `redemptions` (`reward_id`,`user_id`,`redeemed_at`);--> statement-breakpoint
CREATE TABLE `reward_assignees` (
	`reward_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`reward_id`, `user_id`),
	FOREIGN KEY (`reward_id`) REFERENCES `rewards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`cost` integer NOT NULL,
	`funded_from` text DEFAULT 'personal' NOT NULL,
	`limit_count` integer,
	`limit_period` text,
	`link` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rewards_cost_check" CHECK("rewards"."cost" >= 0),
	CONSTRAINT "rewards_funded_from_check" CHECK(funded_from IN ('personal', 'shared')),
	CONSTRAINT "rewards_limit_check" CHECK(("rewards"."limit_count" IS NULL AND "rewards"."limit_period" IS NULL) OR ("rewards"."limit_count" >= 1 AND "rewards"."limit_period" IN ('day', 'week', 'month', 'year')))
);
--> statement-breakpoint
CREATE INDEX `rewards_household_idx` ON `rewards` (`household_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`previous_token_hash` text,
	`expires_at` integer NOT NULL,
	`device_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`last_used_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "sessions_kind_check" CHECK(kind IN ('web', 'mobile'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_uq` ON `sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`oidc_subject` text,
	`username` text,
	`email` text,
	`password_hash` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_subject_uq` ON `users` (`oidc_subject`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_uq` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wallets_kind_check" CHECK(kind IN ('personal', 'shared')),
	CONSTRAINT "wallets_user_check" CHECK(("wallets"."kind" = 'personal' AND "wallets"."user_id" IS NOT NULL) OR ("wallets"."kind" = 'shared' AND "wallets"."user_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_personal_uq` ON `wallets` (`household_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallets_shared_uq` ON `wallets` (`household_id`) WHERE "wallets"."kind" = 'shared';