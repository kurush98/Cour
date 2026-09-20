import type { SourceType } from "@prisma/client";

/**
 * The single writer for catalog fields.
 *
 * The architectural rule (roadmap §2) is that an ingestion sync never
 * overwrites a field whose provenance is OWN. The MAL agreement then adds a
 * second reason: §3(a)(xii) forbids altering provider content, so a MAL value
 * is stored verbatim and one of our corrections is not an edit of it but an
 * independently sourced OWN value that supersedes it for display.
 *
 * Both rules hold only if nothing else writes catalog fields. That is why
 * this is one small function with one job: it is the only place the rule can
 * break, and the only place that has to be reviewed to know it hasn't.
 */

// A type alias rather than an interface, deliberately: TypeScript gives
// aliases an implicit index signature, so this is assignable to Prisma's
// InputJsonValue. An interface here fails to typecheck at every write site.
export type ProvenanceEntry = {
  source: SourceType;
  at: string;
};

export type ProvenanceMap = Record<string, ProvenanceEntry>;

export function parseProvenance(value: unknown): ProvenanceMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: ProvenanceMap = {};
  for (const [field, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object") continue;
    const { source, at } = entry as { source?: unknown; at?: unknown };
    if (typeof source === "string" && typeof at === "string") {
      out[field] = { source: source as SourceType, at };
    }
  }
  return out;
}

export interface ApplyIngestResult<T> {
  /** Fields safe to write, plus the updated provenance and sync stamp. */
  data: Partial<T> & { fieldProvenance: ProvenanceMap; lastSyncedAt: Date };
  /** Fields left alone because we own them. */
  skipped: string[];
}

/**
 * Filters an incoming provider payload against what we already own.
 *
 * @param existingProvenance the row's current `fieldProvenance` JSON
 * @param incoming           provider values; `undefined` entries are ignored
 * @param source             which provider these values came from
 */
export function applyIngest<T extends Record<string, unknown>>(
  existingProvenance: unknown,
  incoming: Partial<T>,
  source: SourceType,
  now: Date = new Date(),
): ApplyIngestResult<T> {
  const provenance = parseProvenance(existingProvenance);
  const data: Record<string, unknown> = {};
  const skipped: string[] = [];
  const at = now.toISOString();

  for (const [field, value] of Object.entries(incoming)) {
    if (value === undefined) continue;

    if (provenance[field]?.source === "OWN") {
      // We sourced this field ourselves. An ingest never touches it.
      skipped.push(field);
      continue;
    }

    data[field] = value;
    provenance[field] = { source, at };
  }

  return {
    data: {
      ...(data as Partial<T>),
      fieldProvenance: provenance,
      lastSyncedAt: now,
    },
    skipped,
  };
}

/**
 * Marks a field as ours. Used by curation tooling when we correct or
 * independently source a value; from then on ingestion leaves it alone.
 */
export function claimOwnership(
  existingProvenance: unknown,
  fields: string[],
  now: Date = new Date(),
): ProvenanceMap {
  const provenance = parseProvenance(existingProvenance);
  const at = now.toISOString();
  for (const field of fields) provenance[field] = { source: "OWN", at };
  return provenance;
}

/**
 * Which fields on a row came from a given provider.
 *
 * Exists for compliance, not curiosity: MAL §18 lets them demand a written
 * report of our current deployment of their content, and §3(e) gives us 24
 * hours to action a takedown. Both need this answerable by query.
 */
export function fieldsFromSource(
  existingProvenance: unknown,
  source: SourceType,
): string[] {
  const provenance = parseProvenance(existingProvenance);
  return Object.entries(provenance)
    .filter(([, entry]) => entry.source === source)
    .map(([field]) => field);
}
