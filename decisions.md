# Cour — decisions log

Every modelling and architectural judgment call, with the reasoning. Append
only; when a decision is reversed, add a new entry that supersedes it rather
than editing history. Maintained for the life of the project.

Status key: **Proposed** (awaiting sign-off) · **Accepted** · **Superseded**

---

## D-001 — Four-level catalog hierarchy: Franchise → Anime → Season → Episode
**Phase 0 · Accepted · 2026-09-20**

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
**Phase 0 · Accepted · 2026-09-20**

A movie becomes one Anime → one implicit Season → one Episode. The row looks
redundant. The alternative — episodes optionally hanging off Anime directly —
puts a branch in logging, rating, progress gating, the seasonal chart and
every aggregate. One uniform path is worth one silly row.

## D-003 — Episode numbering stored twice: `numberInSeason` and `absoluteNumber`
**Phase 0 · Accepted · 2026-09-20**

Broadcast-run numbering (MAL/AniList) and continuous numbering (AniDB) are
both correct for different purposes, and users of both databases expect their
own. Two indexed columns turn a disagreement into data.

## D-004 — `Episode.type` (AniDB typology) is separate from `countsTowardProgress`
**Phase 0 · Accepted · 2026-09-20**

Type describes what the episode is (STANDARD, RECAP, SPECIAL, OP_ED, …);
the boolean describes whether Phase 4 progress-gating counts it. Conflating
them means any future policy change ("do recaps gate episode 8?") is a
migration instead of a data update.

AniDB's typology was chosen over MAL's and AniList's because it is the only
one of the three that is rigorous about credits, trailers and recaps.

## D-005 — Titles in their own table, not a JSON column
**Phase 0 · Accepted · 2026-09-20**

One row per title variant (language + type + isPrimary). Title search is the
most-run query in a catalog app and "Shingeki no Kyojin" / "Attack on Titan" /
"AoT" must all resolve. A row-per-variant supports a single `tsvector` index
across all variants plus `pg_trgm` fuzzy matching; a JSON column supports
neither usefully.

## D-006 — Per-field provenance stored as JSONB, guarded by a single writer
**Phase 0 · Accepted · 2026-09-20**

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
**Phase 0 · Accepted · 2026-09-20**

Applies to `ExternalIdMapping` (→ Anime | Season | Episode) and `Review`
(→ Anime | Season | Episode).

A single `targetId String` is tidier and throws away referential integrity —
nothing prevents orphans pointing at deleted rows. Three nullable foreign keys
with a `CHECK` that exactly one is set keeps real FKs and real cascades. The
table is uglier; the mapping layer is what the entire architecture rests on,
so integrity wins.

## D-008 — Ratings stored as Int on a 1–100 internal scale
**Phase 0 · Accepted · 2026-09-20**

Display scale (5 stars, half-steps, /10) is a UI concern. Storing the display
scale is how a site ends up unable to introduce half-stars without migrating
every rating ever cast. Costs nothing now.

## D-009 — `quarantinedAt` / `quarantineReason` on ratings from day one
**Phase 0 · Accepted · 2026-09-20**

Phase 4 mechanism 4 (burst detection) says flag, never delete. A quarantined
rating stays visible and stays in the displayed distribution; it is excluded
only from the displayed mean. Adding these columns later is a migration on the
largest table in the system, so they ship empty in Phase 0.

## D-010 — Reviews and comments are soft-deleted
**Phase 0 · Accepted · 2026-09-20**

Comments hang off reviews; hard deletion detonates threads. A deleted review
renders as a tombstone with replies intact.

## D-011 — Comments carry a materialised `path` alongside `parentId`
**Phase 0 · Accepted · 2026-09-20**

`parentId` alone makes subtree fetch a recursive CTE per render. A path string
(`"a1.b7.c3"`) makes it a prefix index scan. Depth capped at 8 on write.

## D-012 — `EpisodeRatingStats` denormalised aggregate exists in Phase 0
**Phase 0 · Accepted · 2026-09-20**

Bayesian shrinkage and distribution display are launch requirements, not
Phase 4 ones, and both are needed on every episode card of the seasonal
chart. Per-episode aggregate queries do not survive a busy Saturday.

Updated transactionally on write, plus a nightly reconciliation job that
recomputes from source and logs drift. The job is what makes the
denormalisation safe. Bayesian prior `C` lives in config, not code; starting
value `C = 20` votes toward the global mean.

## D-013 — MAL is an implementation of a `CatalogSource` interface, never the interface
**Phase 0 · Accepted · 2026-09-20**

Reinforced by the licence situation (D-015). The ingestion boundary is typed
and provider-agnostic so that a bad licence answer changes an adapter, not the
application.

## D-014 — Raw provider payloads stored in `ExternalPayload`
**Phase 0 · Accepted · 2026-09-20 · CONTINGENT ON D-015**

Storing the raw JSON means a modelling fix can be re-applied to the whole
catalog at zero API cost. This is persistent storage of provider data and must
be cleared by the licence review. If the agreement forbids it, this table is
dropped and re-mapping means re-fetching.

## D-015 — Phase 0 licence gate CLOSED; bootstrap is viable with four constraints
**Phase 0 · Accepted · 2026-09-20 · supersedes the BLOCKED state**

The build environment could not reach `myanimelist.net`, `help.myanimelist.net`
or `web.archive.org`, and no verbatim copy of the agreement is publicly
indexed. The owner supplied the full text (2019-08-08 revision) on
2026-09-20. Full read in `docs/phase-0/mal-license-review.md`.

Outcome: **the architecture is permitted as designed.** §3(c)'s storage
prohibition covers only personal information and user-generated content, not
catalog data, so storing the catalog server-side and serving every read from
it is fine. There is no anti-competition clause — unlike AniList.

Four constraints bind the build, and one product capability is lost:

1. Commercial use needs MAL's written authorisation (§3(a)(xiv)); the
   definition catches subscriptions, tiered UX and even monthly donations.
   Ads-only remains non-commercial (§1(i)).
2. No server-side storage of MAL user-generated content (§3(c)) — **so there
   is no "import your MAL list". The standard cold-start lever is gone.**
3. No alteration of provider content (§3(a)(xii)) — hence verbatim storage
   plus superseding OWN values, and no translation, ever.
4. No scraping at all (§4(i)) — Jikan is permanently out.

Plus: 24-hour takedown (§3(e)), audit and data handover (§§18, 4(g)), launch
review with a MAL veto (§4(b)), termination at will with our post-termination
retention rights undefined (§12), $50 liability cap, California arbitration.

## D-016 — Timestamps UTC, plus the broadcast *rule* stored separately
**Phase 0 · Accepted · 2026-09-20**

All timestamps are `timestamptz` in UTC. `Season` additionally carries
`broadcastWeekdayJst` and `broadcastTimeJst`, because "Saturdays 23:30 JST" is
a rule and each `Episode.airedAt` is an instance of it. Instants alone cannot
render "airs Saturdays" without reverse-engineering; the rule alone cannot
represent the week a broadcast is pre-empted — which happens constantly.

## D-017 — Hand-written SQL migrations sit alongside Prisma migrations
**Phase 0 · Accepted · 2026-09-20**

Prisma cannot express `tsvector`, `pg_trgm`, `CHECK` constraints or array
columns fully, all of which this schema requires. Those go in hand-written SQL
in the same migration directory. Consequence for the team: the workflow is not
purely `prisma migrate dev`.

## D-018 — Users follow an `Anime`; the seasonal chart is keyed on `Season`
**Phase 0 · Accepted · 2026-09-20 · product decision Q1, owner sign-off**

Following the work is what a fan means. Charting the run is what "this
season" means. A new split-cour part therefore appears on a follower's chart
without them adding anything.

## D-019 — The primary series-level rating attaches to `Season`
**Phase 0 · Accepted · 2026-09-20 · product decision Q2, owner sign-off**

People have opinions about "season 4", not about "the whole show", and MAL's
scores — the ones we are trying to beat — are effectively per-season because
MAL's entries are per-season. `SeasonRating` is primary; `SeriesRating`
(Anime-level) exists as a secondary, optional whole-work score. The roadmap
named only `SeriesRating`; this supersedes that.

Three rating tables, not one polymorphic table: each keeps a real foreign key
and a real unique constraint on (user, target), which a polymorphic table
cannot express.

## D-020 — Display scale is 5 stars in half-steps
**Phase 0 · Accepted · 2026-09-20 · product decision Q3, owner sign-off**

Ten values, 0.5 to 5.0. Stars read as opinion; a 10-point score reads as
measurement, and the entire Phase 4 argument is that MAL's measured-looking
numbers are not trustworthy. Storage is unaffected (D-008): internally 1-100,
so granularity can change without touching a single stored rating.

## D-021 — Rating an episode implies logging it
**Phase 0 · Accepted · 2026-09-20 · product decision Q4, owner sign-off**

The service layer creates the `EpisodeLog` in the same transaction as the
rating. Keeps Phase 4 progress-gating coherent (you cannot have rated
episode 7 without a log for it) and removes a decision from the user.

## D-022 — MAL API v2 exposes no episode data; episodes are synthesised
**Phase 0 · Accepted · 2026-09-20 · needs a follow-up decision**

Discovered while building the client. There is no episodes endpoint: MAL
gives `num_episodes`, a weekly `broadcast` slot, `start_date` and an average
duration. No episode titles, air dates or synopses. The website has them; §4(i)
forbids scraping them.

This collides with the product's first differentiator — "episode-level
everything" — so it is worth stating plainly: **the bootstrap source cannot
provide episode-level data.**

`synthesiseEpisodes()` derives the run (episode n one week after n−1 at the
same JST slot) and marks the rows `MERGED`, not `MAL`: derived, not verbatim,
and so overwritable by a better source while `OWN` stays protected. Good
enough for Phase 1's chart and logging; wrong whenever a broadcast is
pre-empted, a recap is inserted, or a cour splits, and every episode is
titled "Episode 7".

A second source for episode data is needed, and belongs in Phase 1 rather
than Phase 5. Candidates and reasoning in `docs/phase-0/mal-api-gaps.md`.

## D-023 — Split-cour merging is a curation action, never automatic
**Phase 0 · Accepted · 2026-09-20**

MAL offers no reliable signal that two entries are parts of one run — "Part 2"
in a title is a guess, and a sequel looks identical to a second cour. A wrong
automatic merge is much more expensive to unpick than a missing one, because
user logs and ratings have by then attached to the merged record.

So ingestion maps one MAL entry to one Anime with one Season, and
`mergeAnime()` (src/server/catalog/merge.ts) re-parents seasons and remaps
every external id when a human decides. Merges are recorded as `MANUAL`, so a
human judgment is always distinguishable from an ingest guess.

## D-024 — Compliance obligations are code, not prose
**Phase 0 · Accepted · 2026-09-20**

`src/server/catalog/compliance.ts` implements the 24-hour takedown (§3(e)) as
`purgeProviderEntity()` and the audit report (§18) as `provenanceReport()`.
An obligation that only exists in a document gets discovered at the worst
moment; one that exists as a function can be run by an operator without a
deploy.

`purgeProviderEntity` refuses by default when the purge would cascade into
users' logs or ratings, and requires an explicit `allowUserDataLoss` flag.
Our users' data is ours and theirs, not the provider's.

## D-025 — Architectural rules are enforced by a test, not by good intentions
**Phase 0 · Accepted · 2026-09-20**

`tests/architecture.test.ts` fails the build if `src/app` imports the
ingestion layer, if the word Jikan or any scraping library appears anywhere,
or if a MAL-import model is added to the schema. Each corresponds to a
licence obligation. A rule nobody can accidentally break is worth more than a
rule everybody agrees with.

## D-026 — Title de-duplication is on text, not on (text, language)
**Phase 0 · Accepted · 2026-09-20**

Caught by a test. MAL routinely repeats the romaji title inside `synonyms`,
where it arrives tagged `OTHER` while the canonical one is `JA_ROMAJI`. Keying
de-duplication on (text, language) let both survive, which would have shown
the same title twice in every search result. First occurrence wins, and the
title list is built in order of authority.
