-- Hand-written constraints Prisma cannot express (D-017).
-- Run after `prisma migrate deploy`. Idempotent.

-- --------------------------------------------------------------------------
-- Polymorphic targets: exactly one FK set (D-007).
-- --------------------------------------------------------------------------

ALTER TABLE "ExternalIdMapping"
  DROP CONSTRAINT IF EXISTS "ExternalIdMapping_exactly_one_target";
ALTER TABLE "ExternalIdMapping"
  ADD CONSTRAINT "ExternalIdMapping_exactly_one_target" CHECK (
    (("animeId" IS NOT NULL)::int
     + ("seasonId" IS NOT NULL)::int
     + ("episodeId" IS NOT NULL)::int) = 1
  );

-- targetType must agree with whichever FK is set, or the discriminator lies.
ALTER TABLE "ExternalIdMapping"
  DROP CONSTRAINT IF EXISTS "ExternalIdMapping_target_matches_type";
ALTER TABLE "ExternalIdMapping"
  ADD CONSTRAINT "ExternalIdMapping_target_matches_type" CHECK (
    ("targetType" = 'ANIME'   AND "animeId"   IS NOT NULL) OR
    ("targetType" = 'SEASON'  AND "seasonId"  IS NOT NULL) OR
    ("targetType" = 'EPISODE' AND "episodeId" IS NOT NULL)
  );

ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_exactly_one_target";
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_exactly_one_target" CHECK (
    (("animeId" IS NOT NULL)::int
     + ("seasonId" IS NOT NULL)::int
     + ("episodeId" IS NOT NULL)::int) = 1
  );

ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_target_matches_type";
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_target_matches_type" CHECK (
    ("targetType" = 'ANIME'   AND "animeId"   IS NOT NULL) OR
    ("targetType" = 'SEASON'  AND "seasonId"  IS NOT NULL) OR
    ("targetType" = 'EPISODE' AND "episodeId" IS NOT NULL)
  );

-- --------------------------------------------------------------------------
-- Rating domain. Internal scale is 1-100; the UI ships 5 stars in half-steps,
-- which is the ten values 10, 20 ... 100. The constraint enforces the scale,
-- not the granularity, so changing granularity later needs no migration.
-- --------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['EpisodeRating', 'SeasonRating', 'SeriesRating'] LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      t, t || '_score_range');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (
         "overall"   BETWEEN 1 AND 100
         AND ("animation" IS NULL OR "animation" BETWEEN 1 AND 100)
         AND ("story"     IS NULL OR "story"     BETWEEN 1 AND 100)
         AND ("sound"     IS NULL OR "sound"     BETWEEN 1 AND 100))',
      t, t || '_score_range');
  END LOOP;
END $$;

-- Ten histogram buckets, one per half-star.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['EpisodeRatingStats', 'SeasonRatingStats', 'AnimeRatingStats'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_histogram_len');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (array_length("histogram", 1) = 10)',
      t, t || '_histogram_len');
  END LOOP;
END $$;

-- --------------------------------------------------------------------------
-- Misc invariants
-- --------------------------------------------------------------------------

ALTER TABLE "Comment" DROP CONSTRAINT IF EXISTS "Comment_depth_cap";
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_depth_cap"
  CHECK ("depth" >= 0 AND "depth" <= 8);

ALTER TABLE "Follow" DROP CONSTRAINT IF EXISTS "Follow_no_self";
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_no_self"
  CHECK ("followerId" <> "followingId");

-- A split-cour part must say which part it is; a FULL run must not.
ALTER TABLE "Season" DROP CONSTRAINT IF EXISTS "Season_part_number";
ALTER TABLE "Season" ADD CONSTRAINT "Season_part_number" CHECK (
  ("part" = 'SPLIT_PART' AND "partNumber" IS NOT NULL) OR
  ("part" = 'FULL'       AND "partNumber" IS NULL)
);

ALTER TABLE "Season" DROP CONSTRAINT IF EXISTS "Season_broadcast_weekday";
ALTER TABLE "Season" ADD CONSTRAINT "Season_broadcast_weekday"
  CHECK ("broadcastWeekdayJst" IS NULL
         OR "broadcastWeekdayJst" BETWEEN 0 AND 6);
