CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "groups_title_not_blank" CHECK(length(trim("groups"."title")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_one_default_per_project` ON `groups` (`project_id`) WHERE "groups"."is_default" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `groups_title_per_project` ON `groups` (`project_id`,`title`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `group_id` text REFERENCES groups(id) ON DELETE SET NULL;