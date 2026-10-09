CREATE TABLE `login_attempts` (
	`ip` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `history` (
	`id` text PRIMARY KEY NOT NULL,
	`before` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invitations` (
	`student` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_digest_unique` ON `invitations` (`digest`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`student` text NOT NULL,
	`csrf` text NOT NULL,
	`expires` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_student` ON `sessions` (`student`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expiry` ON `sessions` (`expires`);--> statement-breakpoint
CREATE TABLE `state` (
	`id` integer PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`version` integer NOT NULL
);
