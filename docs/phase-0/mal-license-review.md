# Phase 0 gate — MyAnimeList API v2 licence review

Source: MAL API License and Developer Agreement, last modified 2019-08-08,
supplied in full by the project owner on 2026-09-20 (the document is not
publicly reachable from the build environment; see D-015).

**Verdict: the bootstrap is viable, with four hard constraints and one
product capability we must give up.** Detail below. This is a plain-language
engineering read, not legal advice; §§10, 11, 15 and 16 are one-sided enough
that a lawyer should see this before Cour takes a single dollar.

---

## 1. The headline answers

| Question | Answer |
| --- | --- |
| Can we store the catalog in our own database, server-side, permanently? | **Yes.** Not prohibited. See §2.1. |
| Can we be commercial? | **Only with MAL's express written authorisation.** See §2.2. |
| Does it ban competing services? | **No.** Unlike AniList. See §2.3. |
| Can we import a user's MAL list? | **No — not server-side. This is the capability we lose.** See §2.4. |
| Can we correct or merge MAL's data? | **Not without written authorisation.** See §2.5. |
| Can we scrape, or use Jikan? | **Absolutely not.** See §2.6. |
| Rate limits? | None published. MAL may impose or start charging at any time. |
| What happens on termination? | They can terminate at will. Our right to keep serving cached catalog afterwards is **undefined**. See §2.7. |

---

## 2. The clauses that matter

### 2.1 Server-side catalog storage is permitted

§1(f) defines "MyAnimeList Content" very broadly — user info and posts,
anime info, manga info, anything from the API. But the storage prohibition in
§3(c) is *narrower* than that definition:

> "You may not maintain, store or process any MyAnimeList Content **that
> consists of personal information of MyAnimeList users or content generated
> by such users, such as forum posts**, on the server-side of Your
> Applications…"

Anime and manga catalog information is not personal information and is not
user-generated. It is therefore outside this prohibition. **Our core
architecture — bootstrap the catalog, store it in Postgres, serve every user
read from our copy, never hit MAL on a request path — is permitted as
written.** That is the single most important finding here, and it is the one
I could not verify from secondary sources.

Two obligations ride along with it:

- **§3(e), 24-hour takedown.** If MAL content is deleted, suspended,
  withheld, modified or removed on MAL's side, we must make all reasonable
  efforts to mirror that, and in any case within **24 hours of a request**
  from MAL or from a MAL end user. So we need a purge path keyed by external
  ID that an operator can run without a deploy. Our `ExternalIdMapping` table
  makes that a one-query operation, which is lucky rather than clever.
- **§18, audit.** MAL may inspect our records and activity at any time on
  notice, and may demand a written report of our current deployment of the
  API and MyAnimeList Content. This survives for one year after termination.
  We must be able to enumerate, on demand, exactly which data came from MAL.

Both of those are satisfied by per-field provenance (D-006), which I proposed
as data hygiene and which turns out to be a compliance requirement.

### 2.2 Commercial use requires written permission — and the definition is wide

§3(a)(xiv): you may not

> "generate, charge or earn any fees, profits, revenues or other funds or
> amounts through Your Commercial Applications without the express
> authorization of the Company in writing"

It is not a ban. It is a permission gate. But §1(h)'s definition of
"Commercial" catches almost every monetisation route:

- subscriptions and single-pay models
- pay-to-download
- **tiered user experiences based on financial transactions** (so "Cour Pro")
- **crowdfunding and donations via quotas — explicitly including monthly
  donations**, which means a Patreon makes us commercial
- data analysis for commercial use

§1(i) carves out one thing: a free app **may** carry "some pay per click or
pay per view advertising or other similar advertising" and remain
non-commercial, provided the advertising does not disrupt the user experience
and is lawful. §4(h) then constrains the ads themselves (no minors, no adult
content, no discriminatory targeting, no illegal products).

**Practical position: launch free, ad-free or ads-only. The day we want a
subscription or a Patreon, we write to MAL first.** Note §4(b) treats "the
addition of ads" and "previously non-commercial applications becoming
commercial" as major upgrades requiring notification and review, so even the
ad-supported step is a conversation, not a deploy.

### 2.3 There is no anti-competition clause

I looked specifically for AniList's equivalent. It is not there. Nothing in
this agreement prohibits building a tracking service that competes with
MyAnimeList. The closest things are:

- §2(a), which licenses the API "solely for your internal business purposes
  in developing Your Applications that will communicate and interoperate with
  aspects of the Company Offering" — read plainly, using the API *is* the
  interoperation, so this is satisfied.
- §3(a)(ix), you may not "imitate or attempt to impersonate the user
  experience of the Company Offering", and §3(a)(xi), you may not build
  something that could reasonably cause confusion about whether it is a MAL
  product.

Those two are vague, and they are the ones a hostile reading would use
against us. The defence is simply to not look like MAL — which the roadmap
already demands on design grounds. It is now also a legal reason. **Design
note for Phase 1: visual and interaction distinctiveness from MAL is a
compliance property, not just taste.**

### 2.4 We cannot import a user's MAL list. This is a real loss.

§3(c) prohibits server-side storage of "content generated by such users". A
user's MAL anime list, their scores and their episode progress are content
they generated on MAL. Writing those into our `EpisodeLog` and
`EpisodeRating` tables is server-side storage of MAL user-generated content.

Client-side only is permitted, "for the period of time reasonably necessary
for the proper functioning of Your Applications" — which does not describe a
permanent import.

This matters more than it looks. "Import your MAL list" is the standard
onboarding move for every tracker that has ever launched, and it is the
cheapest possible answer to the cold-start problem: a new user arrives with
an empty profile and no reason to come back. **We do not get that lever.**
Phase 1 and Phase 2 onboarding must be designed for users who start from
zero, which makes the seasonal chart's one-tap logging the entire
first-session experience. Plan accordingly.

Two things worth pursuing, neither assumed:

1. MAL's own user-facing list export (the XML download a user takes from
   their own account) is arguably the user's own data being supplied by the
   user, not content we obtained through the API. The counter-argument is
   that §1(f) covers content "made available… by any other means authorized
   by the Company", which an export feature is. **This is genuinely
   ambiguous. Ask MAL in writing before building it.**
2. An import that only reads *which episodes were watched* to pre-fill a
   client-side UI, where the user then confirms, is closer to the permitted
   client-side case — but storing the confirmed result is still storing
   MAL-derived user content. Weak. Not recommended without permission.

Not affected: MAL's aggregate scores and rankings. Those are derived
statistics, not personal information or user posts. (We are not planning to
display MAL scores anyway, and probably shouldn't — our whole pitch is that
they are unreliable.)

### 2.5 We may not alter MAL content — which constrains how we correct it

§3(a)(xii): you may not

> "delete, translate, edit, modify or otherwise alter in any way any
> MyAnimeList Content or any other data communicated from the API without the
> Company's express written authorization."

Read strictly, this is at odds with a lot of what a better catalog means:
fixing wrong episode counts, merging MAL's two split-cour entries into one
work, translating a synopsis.

The defensible position, and the one the architecture should enforce, is a
clean split:

- A field sourced from MAL is stored and displayed **verbatim**. We never
  edit a MAL value in place.
- A field we correct is not an edit of MAL's value. It is an **independently
  sourced value of our own**, marked `OWN`, which supersedes the MAL value
  for display while the MAL value remains stored unaltered.
- Merging two MAL entries under one of our `Anime` records is **structural,
  not content alteration**: each MAL entry is still mapped and stored intact,
  we have simply organised our own records our own way.

That is exactly what the provenance model does. It was proposed as
correctness hygiene; it is now the thing that makes our position arguable.
It is not bulletproof — "or otherwise alter in any way" is drafted broadly
enough to cover almost anything — so **the merge behaviour and our own
corrections belong in the written request to MAL alongside the commercial
question.**

Note also: translating synopses is called out explicitly. No machine
translation of MAL text. Ever.

### 2.6 No scraping, at all

§4(i) forbids data scraping, web scraping, harvesting, or any other
extraction method against MAL, and requires that MyAnimeList Content be
obtained **only** through the API. If we need something the API doesn't
expose, we must ask, and MAL's answer is at their "absolute discretion".

This settles the Jikan question permanently: **Jikan is a scraper. Using it
is a breach, and it is a worse breach than hitting the API would be.** It
must never appear in this codebase, not even in a prototype.

### 2.7 Termination is at will, and the aftermath is undefined

§12 lets MAL terminate or suspend at any time, in their sole discretion, for
any reason. They "will endeavor" to give reasonable notice absent urgency —
that is not a commitment. Breach terminates the agreement immediately and
automatically.

On termination we must destroy all copies of "the API and Company Marks".
Notably, that sentence does **not** say MyAnimeList Content. But the
agreement grants no standalone content licence either — §2(a) licenses the
API, and access to the content flows from it. So after termination, our right
to keep serving a catalog derived from MAL is, at best, unaddressed.

Consequence for planning: **Phase 5 is not "the long-term asset". It is risk
mitigation with an unknown clock on it.** Every month we run on borrowed
catalog data is a month of exposure to a unilateral decision. The provenance
markers are what would let us answer "what do we lose if MAL pulls the plug"
in minutes rather than weeks.

### 2.8 Everything else worth knowing

- **§3(d), OAuth.** "Your Applications will use the OAuth framework provided
  or designated by the Company… for all new user registration and user login
  functionality **through the API**." Read narrowly (and I think correctly),
  this governs login that goes through MAL — it stops apps from collecting
  MAL passwords, which §4(f) reinforces. Cour's own Auth.js accounts are not
  registration "through the API". But the clause is loose enough to support a
  broader reading, and a broad reading would force MAL login on every Cour
  user — an unacceptable dependency for a project whose premise is that MAL
  may vanish. **Add to the written questions.**
- **§4(b), launch review.** We must notify MAL on release and let them review
  the app for compliance, and again for major upgrades. If they disapprove,
  we may not continue without written authorisation. MAL holds a veto at
  launch. Budget time for it; do not schedule a launch date that assumes a
  same-week answer.
- **§4(g), data handover.** On request, we must give MAL "a copy of all data
  collected by you through Your Applications and the use of the API". That is
  drafted broadly enough to reach our users' own logs and ratings. Our
  privacy policy must disclose it. Users deserve to know.
- **§2(b)** grants MAL a licence to crawl any page where we display their
  content. They will be able to watch us. Fine, but assume observation.
- **§4(c)** requires an abuse-reporting resource for users and active
  monitoring — which is Phase 3 moderation tooling, now with a deadline
  attached to launch rather than to Phase 3.
- **§6** no fees today; MAL may start charging or throttle at any time.
- **§4(f)** we must publish a privacy policy no less protective than MAL's,
  and get consent before signup.
- **§§10, 11** we indemnify MAL fully; their total liability to us is capped
  at **fifty dollars**.
- **§§15, 16** California law, San Diego venue, MAL may compel individual
  arbitration, no class claims.
- **§8** any feedback we send MAL is assigned to them outright.

---

## 3. What this changes in the build

| Constraint | Where it lands |
| --- | --- |
| No MAL list import server-side | Onboarding must work from zero. Phase 1 seasonal chart carries the whole first session. |
| Non-commercial until written permission | No subscription/Patreon logic in the schema or the plan. Ads only, if anything. |
| No alteration of MAL content | Provenance model is mandatory, not optional. MAL values stored verbatim; corrections are independent `OWN` values that supersede for display. No translation. |
| 24-hour takedown, audit, handover | Need an operator purge path keyed by external ID, and the ability to enumerate MAL-sourced data on demand. |
| No scraping / no Jikan | Enforced socially and in review. Never in the codebase. |
| Don't imitate MAL's UX | Design distinctiveness is a compliance property. |
| Termination at will, aftermath undefined | Phase 5 urgency increases. `CatalogSource` abstraction stays strict. |
| Launch review + abuse reporting | Both are pre-launch, not Phase 3. |

## 4. Written questions to send MAL

Send via the Customer Support Form (§19(b) requires that channel). Drafted
for the owner to send when ready; not urgent until we approach launch, except
the first if we want certainty early.

1. Does §3(c)'s server-side storage prohibition extend to a user's own MAL
   list data that the user supplies to us via MAL's own export feature?
2. Does §3(d) require MAL OAuth for an application that uses only the public
   catalog endpoints and maintains its own independent user accounts?
3. Does organising multiple MAL entries under a single canonical record in
   our own database — with each MAL entry stored and displayed unaltered —
   fall within §3(a)(xii)?
4. What is the current published rate limit, and is there a documented quota?
5. What process and criteria apply to a request for commercial authorisation
   under §3(a)(xiv)?
