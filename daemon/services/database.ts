import { Database as Sqlite } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Effect } from "effect";
import { schemas } from "../db/schema";
import { DatabaseError } from "../errors/database-error";
import { dbPath } from "../paths/db-path";
import { migrationsDir } from "../paths/migrations-dir";

/**
 * The open database, brought up to date, closed when the scope ends.
 *
 * Two pragmas matter and neither is the default:
 *
 * - **`foreign_keys = ON`** is off in SQLite unless you ask, *per connection*.
 *   Without it `sessions.project_id` is decoration: you can insert a session
 *   against a project that does not exist and the cascade never fires.
 * - **`journal_mode = WAL`** lets a reader attach while the daemon writes. The
 *   daemon is meant to be the one writer with several readers alongside.
 *
 * The -wal and -shm files outlive the close, and that is normal: SQLite
 * recovers them on the next open. Not worth fighting — the strict `close(true)`
 * throws `database is locked` because drizzle keeps prepared statements alive,
 * and the lenient `close()` swallows that same error, so a checkpoint first
 * changes nothing. What releases the file is the process exiting.
 */
export class Database extends Effect.Service<Database>()("magents/Database", {
	scoped: Effect.acquireRelease(
		Effect.try({
			try: () => {
				mkdirSync(dirname(dbPath), { recursive: true });

				const sqlite = new Sqlite(dbPath, { create: true });
				sqlite.exec("PRAGMA journal_mode = WAL");
				sqlite.exec("PRAGMA foreign_keys = ON");

				const db = drizzle(sqlite, { schema: schemas });
				migrate(db, { migrationsFolder: migrationsDir });

				return { db, sqlite };
			},
			catch: (cause) => new DatabaseError({ operation: "open", cause }),
		}),
		({ sqlite }) => Effect.sync(() => sqlite.close()),
	),
}) {}
