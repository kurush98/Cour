import type { SourceType } from "@prisma/client";
import { applyIngest, type ProvenanceMap } from "./provenance";

/**
 * Decides what a sync actually needs to write, before touching the database.
 *
 * Pulled out as a pure function for two reasons. It is the part of ingestion
 * worth testing without a live database, and it is where the cost lives: the
 * naive shape (look up each row, then write it) is two network round trips
 * per episode, which is ~40,000 round trips for a five-season backfill. This
 * lets the caller read every existing row in one query and write the new ones
 * in one more.
 *
 * Rows whose values are unchanged are not rewritten at all. Their
 * `lastSyncedAt` therefore goes stale, which is deliberate: re-stamping
 * twenty thousand unchanged rows on every sync costs minutes and tells us
 * nothing. Sync recency lives on the parent Season and on SyncRun.
 */

export interface PlannedWrite<T> {
  /** Values to write, provenance-filtered and stamped. */
  data: Partial<T> & { fieldProvenance: ProvenanceMap; lastSyncedAt: Date };
}

export interface PlannedUpdate<T> extends PlannedWrite<T> {
  id: string;
}

export interface WritePlan<T, K> {
  creates: Array<PlannedWrite<T> & { key: K; provenance: SourceType }>;
  updates: Array<PlannedUpdate<T>>;
  unchanged: number;
  /** Fields left alone because their provenance is OWN. */
  skippedOwnedFields: string[];
}

type Comparable = Record<string, unknown> & { id: string };

/**
 * True when `data` would actually change `current`. Dates compare by instant,
 * not identity; `fieldProvenance` and `lastSyncedAt` are bookkeeping and are
 * not themselves a reason to write.
 */
export function wouldChange(
  current: Record<string, unknown>,
  data: Record<string, unknown>,
): boolean {
  for (const [field, next] of Object.entries(data)) {
    if (field === "fieldProvenance" || field === "lastSyncedAt") continue;
    const previous = current[field];
    if (previous instanceof Date && next instanceof Date) {
      if (previous.getTime() !== next.getTime()) return true;
      continue;
    }
    if (Array.isArray(previous) && Array.isArray(next)) {
      if (
        previous.length !== next.length ||
        previous.some((value, index) => value !== next[index])
      ) {
        return true;
      }
      continue;
    }
    if (previous !== next) return true;
  }
  return false;
}

/**
 * Matches incoming records against existing ones by a caller-supplied key and
 * sorts them into creates, updates and no-ops.
 */
export function planWrites<T extends Record<string, unknown>, K>(args: {
  existing: Comparable[];
  incoming: Array<{ key: K; fields: Partial<T>; provenance: SourceType }>;
  keyOf: (row: Comparable) => K;
  now: Date;
}): WritePlan<T, K> {
  const byKey = new Map<string, Comparable>();
  for (const row of args.existing) {
    byKey.set(JSON.stringify(args.keyOf(row)), row);
  }

  const plan: WritePlan<T, K> = {
    creates: [],
    updates: [],
    unchanged: 0,
    skippedOwnedFields: [],
  };

  for (const item of args.incoming) {
    const current = byKey.get(JSON.stringify(item.key));

    if (!current) {
      const { data } = applyIngest(null, item.fields, item.provenance, args.now);
      // Provenance travels with the planned row. Deriving it from the input
      // list's index would be wrong the moment some rows already exist.
      plan.creates.push({ key: item.key, data, provenance: item.provenance });
      continue;
    }

    const { data, skipped } = applyIngest(
      current["fieldProvenance"],
      item.fields,
      item.provenance,
      args.now,
    );
    plan.skippedOwnedFields.push(...skipped);

    if (!wouldChange(current, data)) {
      plan.unchanged += 1;
      continue;
    }

    plan.updates.push({ id: current.id, data });
  }

  return plan;
}
