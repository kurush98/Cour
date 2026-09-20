# Cour

Episode-level anime logging, reviews and discussion.

`cour-roadmap.md` is the authoritative project brief. Read it first.

## Status

**Phase 0 — schema and data layer.** No UI by design.

| Deliverable | State |
| --- | --- |
| MAL licence review | Done — `docs/phase-0/mal-license-review.md` |
| Prisma schema | Done — `prisma/schema.prisma` |
| Hand-written SQL (constraints, search) | Done — `prisma/sql/` |
| Provenance enforcement | Done — `src/server/catalog/provenance.ts` |
| MAL ingestion service | Done — `src/server/sources/mal/` |
| Backfill script | Done — `scripts/backfill.ts` |
| `decisions.md` | Maintained |

## Setup

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL, DIRECT_DATABASE_URL, MAL_CLIENT_ID
npm run db:migrate       # Prisma migrations
psql "$DIRECT_DATABASE_URL" -f prisma/sql/001_constraints.sql
psql "$DIRECT_DATABASE_URL" -f prisma/sql/002_search.sql
npm run backfill         # current season + previous four
```

The two SQL files are not optional. They carry the CHECK constraints and the
search indexes that Prisma cannot express (D-017). Run them after every
`prisma migrate`; both are idempotent.

## Checks

```bash
npm run typecheck
npm test
```

`tests/architecture.test.ts` enforces three rules that are otherwise just
promises in a document: the request path may not import the ingestion layer,
no scraper may appear anywhere in the codebase, and there is no MAL list
import. Each of these is a licence obligation, not a style preference.

## Rules that are not negotiable

1. **Our canonical id is the primary key.** External ids live only in
   `ExternalIdMapping`. Never key anything on a MAL id.
2. **Never hit a provider API on a user request path.** Every user-facing
   read serves from our own database.
3. **Ingestion never overwrites an `OWN` field.** All catalog writes go
   through `applyIngest()`. If you are writing a catalog field anywhere else,
   stop.
4. **No scraping.** MAL API agreement §4(i). Jikan is a scraper.
5. **No server-side storage of MAL user-generated content.** §3(c). This is
   why there is no list-import feature.
6. **MAL values are stored verbatim.** §3(a)(xii). Corrections are
   independently sourced `OWN` values that supersede for display; they are
   never edits of a provider value. Never translate provider text.

See `docs/phase-0/mal-license-review.md` for why each of these exists.

## Known gaps

`docs/phase-0/mal-api-gaps.md` — MAL API v2 exposes no per-episode data, so
episodes are currently synthesised from the broadcast rule. Read this before
starting Phase 1.
