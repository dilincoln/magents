import { Effect } from "effect";

/**
 * `GET /health` — the daemon answering, and nothing more.
 *
 * Deliberately shallow: no database, no providers, no work. The question this
 * answers is "is anything listening on the socket", which is the one the status
 * dot asks and the only one that can be asked on a timer without turning a
 * heartbeat into load. A daemon that is up with a broken database is a
 * different failure, and it belongs to whichever request hits the database.
 */
/*
 * `sync`, not `succeed`. A `Response` built once at module load is one object
 * with one body, and a body can only be read once — the first request drains
 * it and every request after that gets a reply the client cannot parse. It
 * shows up as a JSON syntax error on a route that is plainly returning JSON,
 * and only under concurrency, which is the worst possible place to look.
 */
export const getHealth: Effect.Effect<Response> = Effect.sync(() =>
	Response.json({ ok: true }),
);
