# What MAL API v2 does not give us

Found while building the client. This is the most consequential technical
finding of Phase 0 and it deserves a decision from you.

## The problem

**MAL API v2 has no episode endpoint.** There is no `/anime/{id}/episodes`.
The anime object exposes:

- `num_episodes` — a count
- `broadcast` — a weekday and a JST start time
- `start_date` / `end_date`
- `average_episode_duration`

and that is all. No episode titles. No per-episode air dates. No episode
synopses. No episode numbering beyond the total.

MAL's *website* has all of that. Its API does not expose it, and §4(i) of the
agreement forbids scraping the website to get it. So the data exists, twenty
feet away, behind a rule we are not going to break.

## Why this matters more than it sounds

The roadmap's first differentiator is "episode-level everything". The product
thesis is that anime is weekly and episodic and the existing trackers treat a
24-episode series as one row. **The bootstrap source we chose cannot provide
episode-level data.** That is not a detail; it is the premise.

## What I did about it

`synthesiseEpisodes()` derives the episode list: episode *n* airs one week
after episode *n−1* at the same JST slot, starting from `start_date`. Those
rows are marked `MERGED`, not `MAL` — they are computed, not provider values,
which keeps them overwritable by a better source later while `OWN` fields
stay protected.

This is enough to ship Phase 1. The seasonal chart, one-tap logging, "what
aired this week", and progress gating all need an episode to exist at a known
time, and that is exactly what this gives us.

It is **not** enough to be good, and it is wrong in predictable ways:

- Broadcast breaks. A week pre-empted by a sports fixture or a special
  shifts every subsequent episode, and we will be a week off until corrected.
  This happens several times a season, every season.
- Recap episodes inserted mid-run push the numbering out.
- Split-cour gaps of three months are modelled as uninterrupted weekly runs.
- Every episode is titled "Episode 7", which is a bad look on the exact
  screen the product is built around.
- Specials, OVAs and OP/ED entries do not appear at all.

## Options, and my recommendation

| Option | Gets us | Cost |
| --- | --- | --- |
| **A. Ship synthesised episodes, correct by hand** | Phase 1 works now | Curation load grows with the catalog. Untenable past ~50 series. |
| **B. Add a second source for episode data** | Real titles and dates | One more adapter, one more set of terms to read |
| **C. Pull Phase 5 forward for episodes only** | Ours, accurate | Months of work before Phase 1 ships |

**Recommendation: A now, B next, and treat B as part of Phase 1 rather than
Phase 5.** The `CatalogSource` interface already supports two providers
writing different fields of the same record — that is what per-field
provenance is for. Episode air times from a schedule source, catalog
structure from MAL, our corrections on top, each marked and none clobbering
the others.

Candidates for B, in order of how promising they look (none researched
properly yet, and each needs its own licence read before a line of code):

1. **AnimeSchedule.net** — JST-native airing data, built for exactly this,
   has a public API. Best fit for the timing problem specifically.
2. **Annict** — Japanese, open API, genuinely episode-oriented. Best fit for
   episode records as such.
3. **Kitsu** — public API, has episode records of variable quality.
4. **AniDB** — the best episode data that exists, and restrictive terms plus
   a hostile stance toward automated clients. Read carefully before hoping.

AniList remains excluded: its terms prohibit competing trackers.

## What I need from you

Nothing blocking — Phase 1 can start on synthesised episodes today. But
before Phase 1 ships publicly, someone has to pick a source from option B and
read its terms, and it should be a deliberate choice rather than something we
discover we need in week three. Say the word and I'll research the four
candidates properly and come back with a comparison.
