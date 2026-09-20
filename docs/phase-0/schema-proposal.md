# Phase 0 — Schema proposal (awaiting sign-off)

Nothing in here is implemented yet. The roadmap requires sign-off before
code. Read section 8 first if you only read one part — that is where I need
answers from you.

---

## 1. The modelling problem, stated honestly

"What is one anime?" has no correct answer. The three databases disagree,
and they disagree *on purpose*, because they are built for different jobs.

| | Unit of an entry | Split-cour (e.g. a 2-part season) | Episode numbering | Specials/recaps |
| --- | --- | --- | --- | --- |
| **MyAnimeList** | One broadcast run. A "season 2" is usually its own entry. | Usually **two separate entries** ("Part 2", "Final Season Part 2"). | Restarts at 1 per entry. | Often a separate entry entirely; recaps sometimes numbered `13.5`. |
| **AniList** | Mirrors MAL's shape closely; richer relation graph. | Usually two entries, sometimes lagging MAL. | Restarts at 1 per entry. | Separate entries, typed via `format` (SPECIAL/OVA/ONA). |
| **AniDB** | A release/production unit, rigorously defined; strong relation graph. | Usually kept **together** as one entry. | Continuous within the entry. | First-class **episode types** on the same entry: `S` special, `C` credits (NCOP/NCED), `T` trailer, `P` parody, `O` other; recaps ordered before specials. |

The practical consequences:

- MAL gives us **two IDs for one thing** (split-cour) as often as it gives us
  one. A model where one of our records maps to exactly one MAL ID will be
  wrong within the first backfill.
- AniDB gives us **one ID for two things** by the same logic.
- Any model that picks one of these three shapes inherits that database's
  mistakes permanently.

**Proposal: model the shape all three can be projected onto, which is a
three-level hierarchy, and treat every external database's entry as a
mapping onto a *level*, not onto a fixed entity type.**

---

## 2. The core hierarchy

```
Franchise   (optional, soft grouping — "Monogatari", "Fate")
   └── Anime        ← the continuous work. What a user follows.
         └── Season ← one broadcast run / cour / split-cour part
               └── Episode
```

Four rules make this work:

1. **Every episode belongs to exactly one Season. Always.** A film or a
   one-shot OVA gets an implicit single Season containing a single Episode.
   Uniformity here is worth the slightly silly-looking row, because every
   downstream feature (logging, rating, progress gating, the seasonal chart)
   then has exactly one code path instead of two.
2. **`Anime` is ours to define, not MAL's.** When MAL splits one work into
   two entries, we create one `Anime` with two `Season`s, and map both MAL
   IDs onto those Seasons. When AniDB merges two works we consider distinct,
   we map one AniDB ID onto two of our Seasons. Both directions are
   expressible.
3. **`Episode.absoluteNumber`** carries AniDB-style continuous numbering
   across the whole `Anime`; **`Episode.numberInSeason`** carries the
   broadcast-run numbering. Both nullable-safe, both indexed. The disagreement
   between databases becomes two columns instead of an argument.
4. **`Episode.type`** is AniDB's typology, because it is the only one of the
   three that is actually rigorous, plus a separate boolean
   `countsTowardProgress`. Type is *what the episode is*; the boolean is
   *whether Phase 4 progress-gating counts it*. A recap is `RECAP` and does
   not count. Keeping these apart means a policy change later is a data
   update, not a migration.

### Enums

```
AnimeFormat    TV | TV_SHORT | MOVIE | OVA | ONA | SPECIAL | MUSIC
AnimeStatus    NOT_YET_AIRED | AIRING | FINISHED | CANCELLED | HIATUS
SeasonPart     FULL | SPLIT_PART            // a cour, or one half of a split
EpisodeType    STANDARD | RECAP | SPECIAL | OVA | ONA | MOVIE | OP_ED
               | TRAILER | PARODY | OTHER
SourceType     MAL | ANILIST | KITSU | TMDB | ANIDB | ANNICT | OWN | MERGED
MappingTarget  ANIME | SEASON | EPISODE
```

### Relations between works

`AnimeRelation { fromAnimeId, toAnimeId, type }` with
`SEQUEL | PREQUEL | SIDE_STORY | ALTERNATIVE_VERSION | SUMMARY | SPIN_OFF |
PARENT | CHARACTER_SHARED`. Stored directed; we write both directions on
ingest so traversal never needs a `UNION`.

### Titles

Not a JSON blob and not three columns. A `Title` table:

```
Title { id, animeId, text, language (ja|ja-romaji|en|other), type
        (OFFICIAL | SYNONYM | SHORT | ABBREVIATION), isPrimary }
```

Reason: title search is the single most-used query in a catalog app, and
"Shingeki no Kyojin" / "Attack on Titan" / "AoT" / "SnK" must all hit. One
row per variant lets us build one `tsvector` index across all of them plus a
`pg_trgm` index for fuzzy matching. A JSON column cannot be indexed usefully
for this.

---

## 3. Provenance — the rule that protects the whole project

The roadmap says every catalog field carries a provenance marker and an
ingestion sync never overwrites a field whose provenance is `OWN`.

Three ways to implement that, and I picked the third:

| Option | Verdict |
| --- | --- |
| A provenance column per data column (`titleSource`, `synopsisSource`, …) | Doubles the schema width. Rejected. |
| A `FieldProvenance` row per field per entity | Correct, fully queryable, but 20–40× the row count of the catalog and a join on every write. Rejected for now. |
| **A `fieldProvenance Jsonb` column per catalog table** | **Chosen.** |

```
fieldProvenance: {
  "synopsis":   { "source": "OWN",    "at": "2026-09-14T…" },
  "episodeCount": { "source": "MAL",  "at": "2026-09-19T…" }
}
```

Plus row-level `provenance SourceType` and `lastSyncedAt` for the common
case where the whole row came from one place.

The safety of this depends on discipline, so it is enforced structurally:
**no ingestion code writes catalog fields directly.** All writes go through a
single `applyIngest(entity, incomingFields, source)` helper that consults
`fieldProvenance`, skips anything marked `OWN`, and stamps what it did. One
function to review, one function to test, one place this rule can break.

If we later need to query provenance ("show me every field we own"), option 2
becomes a derived table built from the JSONB. Not a rewrite.

---

## 4. External IDs

```
ExternalIdMapping {
  id, provider SourceType, providerEntityType String, providerId String,
  targetType MappingTarget,
  animeId?, seasonId?, episodeId?,      // exactly one is non-null
  confidence Float, mappedBy (AUTO|MANUAL), verifiedAt?, createdAt
  @@unique([provider, providerEntityType, providerId])
}
```

Technical decision: the mapping target is polymorphic, and there are two ways
to do polymorphism in Postgres. A single `targetId String` is tidier but
throws away referential integrity — nothing stops an orphan row pointing at a
deleted anime. Three nullable foreign keys plus a `CHECK` constraint that
exactly one is set keeps real FKs and real cascades, at the cost of a slightly
ugly table. **I chose the ugly table.** Data integrity in the mapping layer is
the thing the entire architecture rests on.

Note the unique constraint is on the *provider* side only. One of our
entities may have many external IDs, and two MAL IDs may point at two Seasons
of one Anime — both are normal and expected.

---

## 5. Users and user-generated content

```
User { id, email, handle @unique, displayName, avatarUrl, bio,
        timezone, createdAt, role, deletedAt }
```

`createdAt` is load-bearing — Phase 4 rating weight reads it. `timezone` is
load-bearing too: Phase 1's airing schedule needs a user-local render of a
JST-sourced time, and guessing from the browser every request is how those
apps break around midnight rollovers.

```
EpisodeLog { id, userId, episodeId, watchedAt, isRewatch, createdAt }
  // multiple rows per (user, episode) allowed — rewatches are real
  // index (userId, episodeId) — progress gating reads this constantly

EpisodeRating { id, userId, episodeId,
                overall Int, animation Int?, story Int?, sound Int?,
                createdAt, editedAt, editCount Int @default(0),
                weight Float @default(1.0),
                quarantinedAt DateTime?, quarantineReason String?
                @@unique([userId, episodeId]) }

SeriesRating  { same shape, keyed on the series-level target — see Q2 }
```

Two technical decisions inside those:

- **Ratings are stored as `Int` on a 1–100 internal scale**, and displayed
  however we want (`/10`, half-stars, five stars). Storing the display scale
  is how sites end up unable to add half-stars without a migration and a
  backfill of every rating ever cast. Costs nothing now.
- **`quarantinedAt` exists from day one** (Phase 4, mechanism 4: flag, never
  delete). A quarantined rating stays visible and stays in the distribution;
  it is only excluded from the displayed mean. Adding this column later means
  a migration on the single largest table in the system.

```
Review  { id, userId, targetType, episodeId?, seasonId?, animeId?,
          title?, body, bodyFormat, containsSpoilers Bool,
          publishedAt, editedAt, deletedAt, commentCount, likeCount }
Comment { id, reviewId, userId, parentId?, path, depth,
          body, createdAt, editedAt, deletedAt }
Follow  { followerId, followingId, createdAt @@id([followerId, followingId]) }
```

- Review targeting uses the same exactly-one-FK pattern as the mapping table,
  for the same reason.
- Reviews and comments are **soft-deleted** (`deletedAt`), because comments
  hang off reviews and hard deletion detonates threads. A deleted review
  renders as a tombstone with its replies intact.
- `Comment.path` is a materialised path (`"a1.b7.c3"`) alongside `parentId`.
  `parentId` alone makes "fetch this subtree" a recursive CTE per render;
  the path column makes it a single prefix index scan. Depth capped (8) at
  write time.

---

## 6. Aggregates — why there is a cache table in a Phase 0 schema

The roadmap makes Bayesian shrinkage and distribution display **launch**
requirements, not Phase 4 ones. Both need a count and a histogram on every
episode card in the seasonal chart. Computing that with an aggregate query per
episode per page load is dead on arrival at the first popular Saturday.

```
EpisodeRatingStats { episodeId @id, count, sum, mean,
                     bayesianMean, histogram Int[10],
                     weightedCount, weightedMean, updatedAt }
```

Updated transactionally on rating write, with a reconciliation job that
recomputes from source nightly and logs drift. Denormalisation is a liability
unless something checks it; the job is what makes it safe.

Bayesian prior (`C` votes of the global mean `m`) lives in config, not code,
so we can tune it without a deploy. Starting point: `C = 20`.

---

## 7. Ingestion layer

```
interface CatalogSource {
  fetchSeason(year, season): Promise<SourceAnime[]>
  fetchAnime(providerId): Promise<SourceAnime>
  fetchEpisodes(providerId): Promise<SourceEpisode[]>
}
```

MAL is *an implementation*, never the interface. Given the licence situation
(see `mal-license-review.md`), this is not architectural purity — it is the
thing that lets us survive a bad answer.

- **Typed client** for MAL API v2, generated types, no `any` at the boundary.
- **Rate limited** by a token bucket, conservative until we see a documented
  quota. **Never on a user request path** — enforced by putting the client in
  a package that the web app cannot import (lint rule + separate workspace).
- **`ExternalPayload { provider, providerId, fetchedAt, body Jsonb }`** stores
  the raw response. Re-mapping after a modelling fix then costs zero API
  calls. *Flagged: this is persistent storage of provider data, which is
  exactly what the licence review needs to clear. If the agreement forbids it,
  this table goes and re-mapping means re-fetching.*
- **`SyncRun { provider, kind, cursor, status, startedAt, finishedAt, stats }`**
  makes backfills resumable and idempotent. A backfill that cannot resume will
  be run twice by accident, and the second run is where duplicate catalog
  entries get created.
- **Backfill script** seeds the current season and the previous four.

### Time handling

Every timestamp is `timestamptz`, stored UTC. Additionally on `Season`:
`broadcastWeekdayJst` and `broadcastTimeJst`, because "Saturdays at 23:30 JST"
is the *rule*, and each `Episode.airedAt` is an *instance* computed from it.
Storing only instants means we cannot render "airs Saturdays" without
reverse-engineering it, and storing only the rule means we cannot handle the
week a broadcast is pre-empted by a baseball game — which happens constantly.

---

## 8. What I need from you

### Stack review (roadmap asks me to object now or not at all)

Next.js App Router + TypeScript + Postgres/Neon + Prisma + Auth.js + Vercel is
the right call for this. Two caveats, both handled, neither a blocker:

1. Prisma on Neon needs the pooled connection string and the driver adapter in
   serverless, or connections exhaust under load. Configuration, not
   architecture.
2. Prisma cannot express `tsvector`, `pg_trgm`, `CHECK` constraints, or array
   columns fully. Those go in hand-written SQL migrations alongside the Prisma
   ones. Normal, but it means migrations are not purely `prisma migrate dev`
   and the team needs to know that.

### Product questions — I need answers before implementing

**Q1. What does a user "follow", an `Anime` or a `Season`?**
When Attack on Titan Final Season Part 2 starts, does it appear on their
seasonal chart because they follow the whole work, or do they add each part?
*My recommendation: follow the `Anime`, chart by `Season`.* Following the
work is what a fan means; charting the run is what "this season" means.

**Q2. Does a series-level rating attach to the `Anime` or the `Season`?**
The roadmap says `SeriesRating`, which implies `Anime`. But people have
opinions about "season 4", not about "the whole show", and MAL's scores —
the ones we are trying to beat — are effectively per-season because MAL's
entries are per-season. *My recommendation: attach to `Season`, and compute
the `Anime`-level number from its seasons.* This changes a table, so I want
your call, not my assumption. **This is the one that is expensive to reverse.**

**Q3. Rating scale shown to users: 1–10 integers, 1–10 in half-steps, or
5 stars in half-steps?** Storage is unaffected (section 5). This is purely
what the UI offers, and it sets the culture of the site — 5 stars reads as
opinion, 10 points reads as scoring. *My recommendation: 5 stars in
half-steps.* It is Letterboxd's, it produces better distributions, and the
whole pitch of Phase 4 is that MAL's 10-point scores feel fake.

**Q4. Can a user rate an episode without logging it?**
*My recommendation: no — rating implies a log, created automatically.*
It makes progress gating coherent and removes a decision from the user.

### Then

On sign-off I implement: repo scaffold, Prisma schema, SQL migrations,
`applyIngest`, the MAL client, the backfill script, and `decisions.md` filled
in as I go. No UI in Phase 0.
