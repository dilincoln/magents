import { defineConfig } from "drizzle-kit";
import { dbPath } from "./daemon/paths/db-path";

export default defineConfig({
	dialect: "sqlite",
	schema: "./daemon/db/schema/index.ts",
	out: "./daemon/migrations",
	dbCredentials: { url: dbPath },
});
