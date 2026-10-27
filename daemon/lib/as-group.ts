import type { Group, GroupRow } from "../db/schema";

/**
 * A stored group as everybody outside the daemon sees one: without its sort
 * key.
 *
 * The key is two opaque bytes of a fractional index. It would cross the wire
 * as `{"type":"Buffer","data":[128,0]}`, and there is nothing a client could
 * do with it that the order of the list has not already done — every list of
 * groups the daemon hands out is sorted by it before it leaves. So it is
 * dropped once, here, and `Group` is the row without it.
 *
 * At the service boundary rather than in each route, because the routes are
 * not the only readers: the CLI resolves a group by name through the same
 * list, and a shape that differed depending on which door it came out of would
 * be two shapes.
 */
export const asGroup = ({ position, ...group }: GroupRow): Group => group;
