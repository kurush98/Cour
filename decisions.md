# Cour — decisions log

Every modelling and architectural judgment call, with the reasoning. Append
only; when a decision is reversed, add a new entry that supersedes it rather
than editing history. Maintained for the life of the project.

Status key: **Proposed** (awaiting sign-off) · **Accepted** · **Superseded**

---

## D-001 — Four-level catalog hierarchy: Franchise → Anime → Season → Episode
**Phase 0 · Proposed · 2026-09-20**

MAL, AniList and AniDB genuinely disagree about what one anime is: MAL and
AniList split most split-cour runs into separate entries, AniDB usually keeps
them together with continuous episode numbering. Adopting any one of those
shapes inherits that database's opinions permanently.

A three-level hierarchy (plus an optional soft Franchise grouping) is the
shape all three can be projected onto. Each external entry maps onto a *level*
rather than onto a fixed entity type, so MAL's two IDs for one work and
AniDB's one ID for two works are both expressible.

Rejected: modelling `Anime` 1:1 with a MAL entry. It is simpler for exactly as
long as the first backfill, and unfixable afterwards.

## D-002 — Every episode belongs to a Season, including films and one-shots
**Phase 0 · Proposed · 2026-09-20**

A movie becomes one Anime → one implicit Season → one Episode. The row looks
redundant. The alternative — episodes optionally hanging off Anime directly —
puts a branch in logging, rating, progress gating, the seasonal chart and
every aggregate. One uniform path is worth one silly row.

## D-003 — Episode numbering stored twice: `numberInSeason` and `absoluteNumber`
**Phase 0 · Proposed · 2026-09-20**

Broadcast-run numbering (MAL/AniList) and continuous numbering (AniDB) are
both correct for different purposes, and users of both databases expect their
own. Two indexed columns turn a disagreement into data.

## D-004 — `Episode.type` (AniDB typology) is separate from `countsTowardProgress`
**Phase 0 · Proposed · 2026-09-20**

Type describes what the episode is (STANDARD, RECAP, SPECIAL, OP_ED, …);
the boolean describes whether Phase 4 progress-gating counts it. Conflating
them means any future policy change ("do recaps gate episode 8?") is a
migration instead of a data update.

AniDB's typology was chosen over MAL's and AniList's because it is the only
one of the three that is rigorous about credits, trailers and recaps.

## D-005 — Titles in their own table, not a JSON column
**Phase 0 · Proposed · 2026-09-20**

One row per title variant (language + type + isPrimary). Title search is the
most-run query in a catalog app and "Shingeki no Kyojin" / "Attack on Titan" /
"AoT" must all resolve. A row-per-variant supports a single `tsvector` index
across all variants plus `pg_trgm` fuzzy matching; a JSON column supports
neither usefully.

## D-006 — Per-field provenance stored as JSONB, guarded by a single writer
**Phase 0 · Proposed · 2026-09-20**

The architectural rule requires per-field provenance and forbids ingestion
from overwriting `OWN` fields.

- Per-field provenance *columns*: doubles schema width. Rejected.
- A `FieldProvenance` row per field: fully queryable, 20–40× the row count
  and a join on every write. Rejected for now.
- **JSONB map per catalog row** (`{field: {source, at}}`) plus row-level
  `provenance` and `lastSyncedAt`: chosen.

JSONB is only as safe as the discipline around it, so the rule is enforced
structurally: no ingestion code writes catalog fields directly. Everything
goes through `applyIngest(entity, fields, source)`, which skips `OWN` fields
and stamps what it wrote. One function to review and test; one place this can
break. If provenance ever needs querying, the row-per-field table becomes a
derived view — not a rewrite.

## D-007 — Polymorphic references use three nullable FKs + a CHECK, not a bare `targetId`
**Phase 0 · Proposed · 2026-09-20**

Applies to `ExternalIdMapping` (→ Anime | Season | Episode) and `Review`
(→ Anime | Season | Episode).

A single `targetId String` is tidier and throws away referential integrity —
nothing prevents orphans pointing at deleted rows. Three nullable foreign keys
with a `CHECK` that exactly one is set keeps real FKs and real cascades. The
table is uglier; the mapping layer is what the entire architecture rests on,
so integrity wins.

## D-008 — Ratings stored as Int on a 1–100 internal scale
**Phase 0 · Proposed · 2026-09-20**

Display scale (5 stars, half-steps, /10) is a UI concern. Storing the display
scale is how a site ends up unable to introduce half-stars without migrating
every rating ever cast. Costs nothing now.

## D-009 — `quarantinedAt` / `quarantineReason` on ratings from day one
**Phase 0 · Proposed · 2026-09-20**

Phase 4 mechanism 4 (burst detection) says flag, never delete. A quarantined
rating stays visible and stays in the displayed distribution; it is excluded
only from the displayed mean. Adding these columns later is a migration on the
largest table in the system, so they ship empty in Phase 0.

## D-010 — Reviews and comments are soft-deleted
**Phase 0 · Proposed · 2026-09-20**

Comments hang off reviews; hard deletion detonates threads. A deleted review
renders as a tombstone with replies intact.

## D-011 — Comments carry a materialised `path` alongside `parentId`
**Phase 0 · Proposed · 2026-09-20**

`parentId` alone makes subtree fetch a recursive CTE per render. A path string
(`"a1.b7.c3"`) makes it a prefix index scan. Depth capped at 8 on write.

## D-012 — `EpisodeRatingStats` denormalised aggregate exists in Phase 0
**Phase 0 · Proposed · 2026-09-20**

Bayesian shrinkage and distribution display are launch requirements, not
Phase 4 ones, and both are needed on every episode card of the seasonal
chart. Per-episode aggregate queries do not survive a busy Saturday.

Updated transactionally on write, plus a nightly reconciliation job that
recomputes from source and logs drift. The job is what makes the
denormalisation safe. Bayesian prior `C` lives in config, not code; starting
value `C = 20` votes toward the global mean.

## D-013 — MAL is an implementation of a `CatalogSource` interface, never the interface
**Phase 0 · Proposed · 2026-09-20**

Reinforced by the licence situation (D-015). The ingestion boundary is typed
and provider-agnostic so that a bad licence answer changes an adapter, not the
application.

## D-014 — Raw provider payloads stored in `ExternalPayload`
**Phase 0 · Proposed · 2026-09-20 · CONTINGENT ON D-015**

Storing the raw JSON means a modelling fix can be re-applied to the whole
catalog at zero API cost. This is persistent storage of provider data and must
be cleared by the licence review. If the agreement forbids it, this table is
dropped and re-mapping means re-fetching.

## D-015 — Phase 0 licence gate is BLOCKED; primary source unreachable
**Phase 0 · Open · 2026-09-20**

`myanimelist.net`, `help.myanimelist.net` and `web.archive.org` are all
blocked by the build environment's network egress proxy, and no verbatim copy
of the MAL API License and Developer Agreement is publicly indexed. The
agreement is presented at registration.

The review cannot be completed from here. Full write-up, secondary-source
findings, the specific clauses that matter, and the retrieval instructions for
the project owner are in `docs/phase-0/mal-license-review.md`. No code is
written until this closes.

## D-016 — Timestamps UTC, plus the broadcast *rule* stored separately
**Phase 0 · Proposed · 2026-09-20**

All timestamps are `timestamptz` in UTC. `Season` additionally carries
`broadcastWeekdayJst` and `broadcastTimeJst`, because "Saturdays 23:30 JST" is
a rule and each `Episode.airedAt` is an instance of it. Instants alone cannot
render "airs Saturdays" without reverse-engineering; the rule alone cannot
represent the week a broadcast is pre-empted — which happens constantly.

## D-017 — Hand-written SQL migrations sit alongside Prisma migrations
**Phase 0 · Proposed · 2026-09-20**

Prisma cannot express `tsvector`, `pg_trgm`, `CHECK` constraints or array
columns fully, all of which this schema requires. Those go in hand-written SQL
in the same migration directory. Consequence for the team: the workflow is not
purely `prisma migrate dev`.

---

## Open product questions (blocking implementation)

- **Q1** Does a user follow an `Anime` or a `Season`? *(recommend: Anime, chart by Season)*
- **Q2** Does a series-level rating attach to `Anime` or `Season`? *(recommend: Season — expensive to reverse)*
- **Q3** Rating scale shown to users? *(recommend: 5 stars, half-steps)*
- **Q4** Can a user rate an episode without logging it? *(recommend: no; rating auto-creates the log)*
