import { join } from "node:path";
import { magentsHome } from "./magents-home";

/**
 * Where the daemon listens. A unix socket rather than a port: there is no port
 * to collide with, no chance of answering the network by accident, and the
 * filesystem permissions on `~/.magents` are the access control.
 *
 * `MAGENTS_SOCKET` overrides it outright, which is what the tests use.
 */
export const socketPath =
	process.env.MAGENTS_SOCKET ?? join(magentsHome, "daemon.sock");
