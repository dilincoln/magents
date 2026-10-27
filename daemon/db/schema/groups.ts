import { sql } from "drizzle-orm";
import {
	blob,
	check,
	integer,
	sqliteTable,
	text,
	unique,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { type FractionalIndexOf, fraciBinary } from "fraci";
import { defineDrizzleFraci } from "fraci/drizzle";
import { projects } from "./projects";

/**
 * The keys that put a project's groups in an order.
 *
 * Fractional indices rather than an integer column, because the operation is
 * "put this one between those two" and an integer answers that by rewriting
 * every row after it. A key here is a value strictly between its neighbours,
 * so moving a bucket is one UPDATE of one row no matter how many are around
 * it, and no other row's key ever changes.
 *
 * Binary rather than the string form: the keys are two bytes each, they are
 * never read by a person, and SQLite compares BLOBs bytewise — which is the
 * ordering fraci assumes. The string form would need the column and its index
 * pinned to a bytewise collation to mean the same thing.
 *
 * The brand is a type-level tag. It is what stops a key from another table
 * being handed to this one, which the compiler could not otherwise tell apart
 * from a correct call.
 */
const order = fraciBinary({ brand: "magents.groups.position" });

/**
 * A bucket of sessions inside a project, named by whoever made it.
 *
 * The names are not ours. Claude's agent view ships fixed ones — *Ready to
 * Review*, *Working*, *Completed* — which describe the lifecycle somebody at
 * Anthropic had in mind; a group here describes the one you have. `Active`,
 * `JIRA-1000`, `waiting on CI`, `stale` are all equally sensible and none of them
 * is a state the daemon could have inferred.
 *
 * Which is why nothing in the daemon ever moves a session between groups. A
 * group means whatever the person who typed the name meant, so the only thing
 * that can be wrong about it is somebody else deciding when it changes.
 */
export const groups = sqliteTable(
	"groups",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => Bun.randomUUIDv7()),

		/**
		 * The project it belongs to. Groups do not travel: a bucket called
		 * `Active` in one repository has nothing to do with one of the same name
		 * in another, and sharing them would make the roster's tree a lie.
		 */
		projectId: text("project_id")
			.notNull()
			.references(() => projects.id, { onDelete: "cascade" }),

		title: text("title").notNull(),

		/**
		 * Where this project's new sessions are born, when nobody says otherwise.
		 *
		 * `is_default` rather than `default`, which is a reserved word — the
		 * quoting would work and the first person to write raw SQL against this
		 * would find out the hard way.
		 *
		 * At most one per project, held by the partial unique index below rather
		 * than by whoever happens to be writing. A project with none is ordinary
		 * and means new sessions land loose under it, which is exactly what every
		 * session did before this table existed.
		 */
		isDefault: integer("is_default", { mode: "boolean" })
			.notNull()
			.default(false),

		/**
		 * Whether landing here puts the agent to sleep.
		 *
		 * The one piece of behaviour a group carries, and it is behaviour the
		 * person declared rather than behaviour anybody inferred. A bucket called
		 * `Done` that stops its agents is a rule about what `Done` *means* to you,
		 * which is not a thing the daemon could ever have worked out — it is the
		 * difference between shipping fixed lanes and shipping the lane.
		 *
		 * On **moves only**, never on creation. A session opened into a group is
		 * somebody asking for work to start; killing it the moment it was asked
		 * for would be the rule firing in the one case it was not written for,
		 * and a hibernating group that also happened to be the default would kill
		 * every new session at birth. See `moveSession`.
		 */
		hibernates: integer("hibernates", { mode: "boolean" })
			.notNull()
			.default(false),

		/**
		 * Whether its sessions are folded away.
		 *
		 * This lived in the TUI's own store, and the comment there argued it
		 * belonged there: a fold was a fact about *that* pane, where attention is
		 * a fact about the session and so has to be shared. The reasoning was
		 * sound and the premise was wrong. Two panes on one daemon are not two
		 * people looking over each other's shoulders — they are one person, in
		 * two terminals, on one machine, and a heading folded in one of them is
		 * something they decided about the *bucket*. Coming back to the other
		 * window and finding it open again is the tool forgetting.
		 *
		 * `false` for a group nobody has touched, which is the answer a heading
		 * made a second ago needs: it is open, and its one session is visible.
		 *
		 * A search still overrules it, and that stays in the screen where it
		 * belongs — a query is a question being asked right now, in one window,
		 * and it does not unfold anything for anybody else.
		 */
		collapsed: integer("collapsed", { mode: "boolean" })
			.notNull()
			.default(false),

		/**
		 * Where it sits among its project's groups.
		 *
		 * Not the order they were made in, which is what `id` gives for free and
		 * what this list used to be sorted by. The buckets are a person's own
		 * lanes — `Active`, `waiting on CI`, `Done` — and the order they are read
		 * in is part of what they mean; the order they happened to be typed in is
		 * an accident of the afternoon.
		 *
		 * Never handed out. `Group` is this row without it — see below — because
		 * the key is how the daemon keeps the order, not something a client has
		 * any use for: the list arrives sorted, and a client that reordered by
		 * this field would be doing the sort twice.
		 */
		position: blob("position", { mode: "buffer" })
			.notNull()
			.$type<FractionalIndexOf<typeof order>>(),
	},
	(table) => [
		// One default per project, in the database rather than in a service. The
		// service that sets one still clears the others — this is what makes it
		// impossible to end up with two by any other route, including a hand-run
		// UPDATE.
		uniqueIndex("groups_one_default_per_project")
			.on(table.projectId)
			.where(sql`${table.isDefault} = 1`),
		// Two groups with one name in one project is a tree nobody can read and a
		// reference the CLI has to refuse. Across projects it is fine and expected.
		unique("groups_title_per_project").on(table.projectId, table.title),
		check("groups_title_not_blank", sql`length(trim(${table.title})) > 0`),
		// Uniqueness first — two groups with one key in one project is an order
		// that depends on which row the query engine reaches first — and the
		// index it takes to enforce that is the same index the lookups want:
		// every question fraci asks is "the neighbours of this key, in this
		// project", which is a range scan over exactly these two columns in
		// exactly this order.
		uniqueIndex("groups_position_per_project").on(
			table.projectId,
			table.position,
		),
	],
);

/**
 * The row as it is stored, sort key and all. Inside the daemon only.
 */
export type GroupRow = typeof groups.$inferSelect;

/**
 * A group as everybody outside the daemon sees one: the row without its key.
 *
 * The order is carried by the order of the list, which is the only form a
 * client can use anyway — a fractional index is a couple of opaque bytes, it
 * would cross the wire as `{"type":"Buffer","data":[128,0]}`, and nothing on
 * the far side would be able to do anything with it but sort by it a second
 * time. See `asGroup`, which is where every route drops it.
 */
export type Group = Omit<GroupRow, "position">;

/**
 * Everything fraci needs to keep this table in order: the keys, the column
 * they live in, what counts as one list, and what names a row inside one.
 *
 * The group is the project, so every project's buckets are ordered among
 * themselves and a key means nothing outside the one it belongs to — which is
 * the same rule the title's uniqueness follows, one level up.
 */
export const groupOrder = defineDrizzleFraci(
	order,
	groups,
	groups.position,
	{ projectId: groups.projectId },
	{ id: groups.id },
);
