# Phase 0 gate — MyAnimeList API v2 licence review

Status: **BLOCKED — primary source not readable from the build environment.**
Owner action required (see "What I need from you").

## What happened

Phase 0 requires reading the MAL API v2 License and Developer Agreement and
reporting on it before any code is written. I attempted to read the primary
text and could not:

| Source | Result |
| --- | --- |
| `myanimelist.net/static/apiagreement.html` | Blocked by network egress proxy |
| `help.myanimelist.net` (API help article) | Blocked by network egress proxy |
| `web.archive.org` copy of the agreement | Fetch not permitted from this environment |
| Web search for a mirrored full text | No verbatim copy found anywhere public |

The agreement is not published in a form search engines have indexed in full.
It is shown to you at registration time and accepted there.

## What is verifiable from secondary sources

Treat all of this as **secondary and unconfirmed**. It is directionally
useful for planning, not a basis for a launch decision.

1. The document is titled "MAL API License and Developer Agreement", last
   widely-cited revision dated 2019-08-08.
2. Registration at `myanimelist.net/apiconfig/create` asks you to declare
   whether the app is **commercial or non-commercial**, and the two are
   treated differently. Non-commercial apps are self-serve via a Client ID.
   Commercial use appears to require a separate arrangement / approval.
3. Attribution to MyAnimeList as the data source is expected.
4. **Scraping is forbidden.** MAL's general Terms of Use separately forbid
   automated collection and aggregating MAL content for use elsewhere. This
   is why Jikan (an unofficial scraper) does not solve the problem: using
   Jikan puts you further outside the terms, not inside them.
5. Nothing verifiable was found either way on the two clauses that matter
   most to this project: **persistent storage of catalog data in our own
   database**, and **building a service that competes with MAL**.

## Why this matters more than a normal licence check

Cour's plan is, stated plainly: store MAL's catalog persistently in our own
Postgres, serve every user-facing read from that copy (never from MAL), and
run a competing tracking service that may later be commercial. If the
agreement restricts any of persistent storage, commercial use, or competing
services, points 2 and 5 above are each independently capable of killing the
MAL bootstrap.

Note the precedent already in the roadmap: AniList's terms explicitly
prohibit competing trackers. It would be unsurprising if MAL's do something
similar. **Do not assume the bootstrap is legal until the text is read.**

## What I need from you

Two minutes of your time. Do this:

1. Open <https://myanimelist.net/apiconfig> in your browser (log in to your
   MAL account, or make one — it's free).
2. Click **Create ID**. You do not have to finish the form.
3. On that page there is a link to the **API License and Developer
   Agreement**. Open it.
4. Select the whole agreement text (Ctrl+A / Cmd+A on that page is fine),
   copy it, and paste it into our chat. Long is fine — paste all of it.

If the link is hard to find: the direct URL is
`https://myanimelist.net/static/apiagreement.html`. If that 404s, MAL moved
it; the registration form will link to wherever it lives now.

I will then read it and report, in plain terms, on:

- commercial use and monetisation (ads, subscriptions, any revenue)
- caching vs. persistent storage of catalog data, and for how long
- whether a competing tracker is permitted
- attribution wording and placement requirements
- rate limits and any published quota
- what we must delete if access is terminated

## Contingency if the answer is bad

If MAL turns out to be closed to us, Phase 0's architecture still holds —
that is the entire point of the canonical-ID rule. What changes is only
which adapter fills the catalog first. Candidates to evaluate at that point,
in rough order of promise:

- **Annict** (Japanese, open API, seasonal/episode oriented)
- **AnimeSchedule.net** (airing times, JST-native)
- **Kitsu** (public API, permissive-ish, weaker episode data)
- **TMDB** (permissive terms, weak anime metadata)
- **manami-project / anime-offline-database** (ID cross-mapping, not content)
- Direct Japanese broadcast sources — which is Phase 5 anyway, just earlier

None of these is researched yet. This list is a starting point, not a
recommendation.
