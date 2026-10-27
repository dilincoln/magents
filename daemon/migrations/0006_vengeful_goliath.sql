-- Hand-written, like 0004. What drizzle-kit generated for this change was
-- `ALTER TABLE groups ADD position blob NOT NULL`, which SQLite refuses
-- outright: a NOT NULL column added to an existing table needs a default,
-- whether or not there are any rows to give it to.
--
-- x'8000' is not an arbitrary filler. It is the first key fraci hands out for
-- an empty list, so it is exactly right for the first group in a project and
-- the unique index below refuses it for any second one — the default cannot
-- quietly produce a duplicate order.
ALTER TABLE `groups` ADD `position` blob DEFAULT x'8000' NOT NULL;--> statement-breakpoint
-- The keys the existing groups should have had: creation order, per project,
-- which is what this list was sorted by until now.
--
-- These are the same bytes fraci produces when it appends to a list N times —
-- x'8000', x'8001' … x'80ff', then x'810000' — verified against
-- `generateNKeysBetween(null, null, 600)`, key for key. They have to be its
-- own encoding and not merely increasing: the next move reads one of them and
-- asks for a value strictly between it and its neighbour.
UPDATE `groups` AS g
SET `position` = unhex(
	CASE WHEN o.rn < 256 THEN printf('80%02x', o.rn) ELSE printf('81%04x', o.rn - 256) END
)
FROM (
	SELECT `id`, row_number() OVER (PARTITION BY `project_id` ORDER BY `id`) - 1 AS rn
	FROM `groups`
) AS o
WHERE g.`id` = o.`id`;--> statement-breakpoint
-- Last, so the rewrite above is not walking into an index that the default has
-- already filled with one value repeated.
CREATE UNIQUE INDEX `groups_position_per_project` ON `groups` (`project_id`,`position`);
