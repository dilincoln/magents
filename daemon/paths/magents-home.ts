import { homedir } from "node:os";
import { join } from "node:path";

/** Everything magents keeps on disk lives under one directory. */
export const magentsHome =
	process.env.MAGENTS_HOME ?? join(homedir(), ".magents");
