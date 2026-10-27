import { request } from "./request";

/** Whether the daemon is listening. Throws `DaemonUnreachable` when it is not. */
export const checkHealth = (): Promise<{ ok: boolean }> => request("/health");
