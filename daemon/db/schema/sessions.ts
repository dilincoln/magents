import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { groups } from "./groups";
import { projects } from "./projects";

/** Same vocabulary the TUI uses. Widening this is a migration, on purpose. */
export const PROVIDERS = ["claude", "codex"] as const;
export type ProviderId = (typeof PROVIDERS)[number];

export const sessions = sqliteTable(
	"sessions",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => Bun.randomUUIDv7()),

		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),

		/**
		 * The bucket it sits in, or null for none.
		 *
		 * Nullable because a group is something a person decides to have. A
		 * project with no groups is the ordinary state — it is every project as
		 * this shipped — and its sessions hang directly off it in the roster, the
		 * way they always did.
		 *
		 * `set null` and emphatically not `cascade`: removing a bucket is a
		 * statement about the bucket. Taking the conversations inside it with it
		 * would be the most expensive possible reading of "delete this group", and
		 * the sessions land back where they were before anybody made one.
		 */
		groupId: text("group_id").references(() => groups.id, {
			onDelete: "set null",
		}),

		provider: text("provider", { enum: PROVIDERS }).notNull(),

		/**
		 * The provider's own handle for this conversation — what its `resume`
		 * takes. Kept apart from `id` because only one provider lets us choose:
		 * claude takes `--session-id` and gets ours, codex mints its own and has
		 * to be asked for it. Null until it is known, and a session without one
		 * cannot be reattached.
		 *
		 * On an imported claude session this is the fork's handle and not the one
		 * that was pasted in. The pasted one belongs to somebody else's session,
		 * which the import deliberately leaves running and untouched; the moment
		 * the fork exists it is the only handle this row has any claim on, so it
		 * is the only one kept.
		 */
		externalId: text("external_id"),

		/**
		 * The first line of what was asked. Not the conversation — that belongs to
		 * the CLI and is read back by resuming it. This exists because a list of
		 * UUIDs is not a list anyone can use.
		 */
		title: text("title").notNull(),

		/**
		 * Whether this session has something to say that nobody has looked at.
		 *
		 * Stored rather than kept in a screen, and that is the whole point of it
		 * being here: two TUIs open on one daemon have to agree about which rows
		 * are lit, and a flag held in one of them is a flag the other one is
		 * wrong about. It is also the only way the fact can outlive the window —
		 * a session that finished while nothing was watching is exactly the case
		 * this exists for.
		 *
		 * Set by the provider's own hooks, which the daemon installs on the
		 * command line when it spawns an agent, and by every path that mints a
		 * session: something opened by the CLI in another terminal is a row
		 * appearing in a roster nobody asked, which is the same problem wearing a
		 * different hat. Cleared by a client putting the cursor on it, because
		 * that is what having looked at it means.
		 */
		requiresAttention: integer("requires_attention", { mode: "boolean" })
			.notNull()
			.default(false),

		/** what it was started on, for the row to say and for a relaunch to repeat */
		model: text("model"),
		variant: text("variant"),

		/**
		 * The process, while there is one. The only column here that is not a
		 * fact that stays true: the daemon that wrote it may be gone, the OS
		 * recycles pids, and "the agent is running" and "something else has that
		 * number now" are indistinguishable from the value alone. Written by the
		 * daemon that spawned the child, nulled when it exits, and cleared
		 * unconditionally at boot — so a non-null pid means exactly "the daemon
		 * running right now spawned this and has not seen it end". Read by the
		 * boot reaper and by the roster's mark. Not a handle: nothing outside
		 * `reconcile-terminals.ts` dereferences it.
		 */
		pid: integer("pid"),

		/**
		 * Field 22 of `/proc/<pid>/stat` — the kernel's process start time, in
		 * clock ticks since boot. Not a display timestamp and not a second copy
		 * of the UUIDv7's mint time: it is the tiebreak that tells our orphan
		 * apart from whoever inherited the number. Without it the boot reaper is
		 * a coin flip on someone else's process and should be deleted rather
		 * than trusted.
		 */
		pidStartedAt: integer("pid_started_at"),
	},
	(table) => [
		index("sessions_project_id_idx").on(table.projectId),
		// `{ enum: ... }` is a TypeScript claim, not a stored constraint. The
		// daemon will take writes from outside TypeScript, so the database has to
		// hold the line itself.
		check(
			"sessions_provider_check",
			sql`${table.provider} in ('claude', 'codex')`,
		),
	],
);

export type Session = typeof sessions.$inferSelect;
