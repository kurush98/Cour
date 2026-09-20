# Cour — Project Roadmap

An anime episode-logging, review and discussion platform. Letterboxd's model
applied to episodic anime.

This document is the authoritative project brief. Read it fully before
starting any phase. It is written to be handed to Claude Cowork as the
standing context for the build.

---

## 1. What we're building

A platform where anime fans log episodes as they air, write reviews at the
episode level, and discuss those reviews. Their profile accumulates into a
body of work over time.

### The three differentiators

1. **Episode-level everything.** Logging, rating and reviewing happen per
   episode, not per series. Anime is weekly and episodic; the existing
   tracking sites treat a 24-episode series as one row in a spreadsheet.
2. **Reviews as identity, not thread content.** A good episode writeup on
   Reddit is buried in 48 hours. Here it lives permanently on the author's
   profile and accumulates. This is why Letterboxd beat film forums.
3. **A rating system built to resist review bombing**, described in Phase 4.

### Who we're competing with

- **MyAnimeList** — largest database, dated UI, thin episode data, scores
  widely considered unreliable.
- **AniList** — better charts and API, but its terms explicitly prohibit
  competing tracker services from using its data. Not an option for us.
- **r/anime weekly discussion threads** — the real competitor. This is
  where episode conversation actually happens today. It is free, has
  enormous default traffic, and is good. We do not beat it on conversation
  volume. We beat it on permanence and attribution.

---

## 2. The non-negotiable architectural rule

We bootstrap catalog data from the MyAnimeList API while building our own
catalog in parallel. Therefore, from the first commit:

- Every anime, season and episode has **our own canonical ID** as its
  primary key (CUID or UUID, never an integer sequence, never an
  external ID).
- External IDs (MAL, AniList, Kitsu, TMDB, AniDB) live **only** in a
  separate `ExternalIdMapping` table. They are foreign keys. Never
  primary keys.
- Every user-generated object — rating, review, log entry, comment, list —
  references **our** canonical ID. No exceptions.
- Every catalog field carries a provenance marker (`MAL` | `OWN` |
  `MERGED`) and a `lastSyncedAt` timestamp, so we always know what we own
  versus what we borrowed.
- An ingestion sync **never** overwrites a field whose provenance is `OWN`.

The goal: swapping in our own catalog later is a backfill job, not a
rewrite. MAL has taken its API fully offline before. Assume it will again.

**If any design decision would violate this rule, stop and flag it.**

---

## 3. Stack

- Next.js (App Router) + TypeScript
- Postgres on Neon (not SQLite — we need concurrent writes and real
  full-text search on the catalog)
- Prisma
- Auth.js
- Vercel

If any of this is wrong for the use case, say so before building, not
after.

---

## 4. Phases

### Phase 0 — Schema and data layer

**No UI this phase.** This is the phase that cannot be redone later.

**Before writing any code:** read the MyAnimeList API v2 License and
Developer Agreement. Report back in plain terms what it permits regarding
commercial use, caching, and persistent data storage. Flag anything that
constrains this plan. Do not proceed to code until this is reported and
acknowledged.

**Then:** propose the schema and wait for sign-off before implementing.

Deliverables:

1. **Prisma schema** covering:
   - `Anime` (canonical work), `Season`, `Episode`. Must correctly handle
     the messy cases: split-cour seasons, recap episodes, specials, OVAs,
     movies, and series that MAL splits into separate entries but are one
     work. Research how MAL, AniList and AniDB disagree about what counts
     as a single entry, then pick a model that can represent all three.
   - `ExternalIdMapping` — our ID to (provider, provider entity type,
     provider ID).
   - `User`, including account creation date (needed for rating weight in
     Phase 4).
   - `EpisodeLog`, `EpisodeRating`, `SeriesRating`, `Review` (attachable
     to either an episode or a series), `Comment` (threaded, attached to
     a review).
   - Ratings support multi-axis scores (overall, animation, story, sound)
     as nullable columns from day one, even though we launch with overall
     only.
   - Every rating carries: value, createdAt, editedAt, edit count, and a
     `weight` field defaulting to 1.0, unused until Phase 4.

2. **MAL ingestion service**
   - Typed client for MAL API v2.
   - Rate limited and cached. **Never hit MAL on a user request path.**
     Every user-facing read serves from our own database.
   - Idempotent upsert mapping MAL entries onto our canonical model via
     `ExternalIdMapping`, respecting the `OWN` provenance rule.
   - Backfill script to seed the current season and the previous four.

3. **`decisions.md`** recording every modeling judgment call and the
   reasoning behind it. This file is maintained for the life of the
   project.

---

### Phase 1 — Seasonal chart and episode logging

The weekly habit loop. This is the core of the product and the thing MAL
is worst at.

- Seasonal chart view: current season, everything airing, filterable.
- One-tap episode logging from the chart.
- "Currently watching" view showing what aired this week that the user
  hasn't logged yet.
- Series and episode detail pages.
- Airing schedule with correct timezone handling (JST source, user-local
  display — this is where most anime apps break).

Success condition: a user opens this every Saturday without being
prompted.

---

### Phase 2 — Reviews and profiles

The identity layer. This is what makes the product worth using over
Reddit.

- Write a review attached to an episode or a series.
- User profile as a body of work: reviews, logging history, stats,
  favourites.
- Review permalinks. Every review is a stable, shareable, attributable
  URL.
- Basic following.

Design principle: the profile should be something a user wants to link
in their bio.

---

### Phase 3 — Discussion

- Threaded comments on reviews.
- Notifications.
- Moderation tooling (reporting, hiding, rate limits on new accounts).

Do not attempt to replicate a general forum. Discussion attaches to a
review, always. The review is the root.

---

### Phase 4 — Rating integrity

Do not build this before there is real rating volume. At 200 users the
problem is an empty room, not a bombing campaign. But the schema supports
it from Phase 0.

Mechanisms, in order of value:

1. **Progress gating.** A user cannot rate episode 7 without episodes 1–6
   logged. This alone kills most drive-by bombing, because it turns one
   click into twelve. Film sites cannot do this. We can.
2. **Bayesian shrinkage.** Pull low-sample scores toward the global mean.
   A three-vote episode must never display as a 10. This is mandatory
   from launch, not a Phase 4 item, because early on every episode is a
   low-sample episode.
3. **Show the distribution, not just the mean.** A bimodal spike of 1s
   and 10s is self-documenting. Hiding it behind an average is exactly
   what makes MAL scores feel fake.
4. **Timing windows.** No rating before airtime plus runtime. Detect
   bursts (e.g. fifty 1-star ratings within two hours of airing) and
   quarantine them from the displayed average while keeping them
   visible. Flag, never silently delete.
5. **Multi-axis scoring.** Most anime "bombing" is not malice — it is
   people scoring an episode 1 because the adaptation cut a scene. Give
   that complaint a legitimate place to go and it stops poisoning the
   overall number.
6. **Reputation weighting.** Weight users by how their rating history
   correlates with the broader distribution. Correct long-term answer,
   meaningless without years of data. Schema-ready, build last.

---

### Phase 5 — Own the catalog

Swap our own catalog in behind the mapping layer, built from Japanese
production and broadcast sources rather than by rescraping MAL. Accurate,
earlier, and ours.

This is the actual long-term asset. The app is what justifies building it
and what proves the data is better than what exists.

---

## 5. Working agreement

- Ask before making **product** decisions. Make **technical** decisions
  yourself and report what was chosen.
- Strong design opinions on this project. Generic AI-looking UI will be
  rejected. Show direction before building screens.
- Push back when the plan is wrong. Do not agree to be agreeable.
- Maintain `decisions.md` throughout.
