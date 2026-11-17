CREATE TABLE `instance_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `users` ADD `is_super_admin` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `deleted_at` integer;
--> statement-breakpoint
-- Existing instances: the first account ever created becomes the super admin (new ones do so at setup).
UPDATE `users` SET `is_super_admin` = 1 WHERE `id` = (SELECT `id` FROM `users` ORDER BY `created_at` ASC, `id` ASC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM `users` WHERE `is_super_admin` = 1);
