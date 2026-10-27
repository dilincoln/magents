import { join } from "node:path";
import { magentsHome } from "./magents-home";

/** `MAGENTS_DB` overrides it outright, which is what the tests use. */
export const dbPath = process.env.MAGENTS_DB ?? join(magentsHome, "magents.db");
