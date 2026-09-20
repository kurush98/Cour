-- Title search. Prisma cannot express tsvector or trigram indexes (D-017).
-- All title variants share one index so "Shingeki no Kyojin", "Attack on
-- Titan", "AoT" and "SnK" all resolve to the same Anime (D-005).

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE "Title" DROP COLUMN IF EXISTS "searchVector";
ALTER TABLE "Title" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce("text", ''))) STORED;

CREATE INDEX IF NOT EXISTS "Title_searchVector_idx"
  ON "Title" USING GIN ("searchVector");

-- Fuzzy match for typos and partial input. `simple` rather than `english`
-- because romaji and Japanese are not English and stemming them is wrong.
CREATE INDEX IF NOT EXISTS "Title_text_trgm_idx"
  ON "Title" USING GIN ("text" gin_trgm_ops);

-- Ranked lookup helper. Primary official titles outrank synonyms.
CREATE OR REPLACE VIEW "TitleSearch" AS
SELECT
  t."animeId",
  t."text",
  t."language",
  t."type",
  t."isPrimary",
  t."searchVector",
  CASE
    WHEN t."isPrimary" THEN 1.0
    WHEN t."type" = 'OFFICIAL' THEN 0.8
    WHEN t."type" = 'SHORT' THEN 0.6
    ELSE 0.4
  END AS "rankBoost"
FROM "Title" t;
