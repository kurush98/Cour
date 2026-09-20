import { z } from "zod";

/**
 * MAL API v2 response shapes, validated at the boundary so nothing untyped
 * reaches the mapper.
 *
 * Note what is NOT here: there is no episode list. MAL API v2 exposes
 * `num_episodes` and a weekly `broadcast` slot, and nothing per-episode — no
 * titles, no air dates, no synopses. See docs/phase-0/mal-api-gaps.md.
 */

export const malPicture = z.object({
  medium: z.string().optional(),
  large: z.string().optional(),
});

export const malBroadcast = z.object({
  day_of_the_week: z.string().optional(),
  start_time: z.string().optional(),
});

export const malStartSeason = z.object({
  year: z.number(),
  season: z.enum(["winter", "spring", "summer", "fall"]),
});

export const malAlternativeTitles = z.object({
  synonyms: z.array(z.string()).optional(),
  en: z.string().optional(),
  ja: z.string().optional(),
});

export const malStudio = z.object({ id: z.number(), name: z.string() });

export const malAnime = z.object({
  id: z.number(),
  title: z.string(),
  main_picture: malPicture.nullish(),
  alternative_titles: malAlternativeTitles.nullish(),
  start_date: z.string().nullish(),
  end_date: z.string().nullish(),
  synopsis: z.string().nullish(),
  media_type: z.string().nullish(),
  status: z.string().nullish(),
  num_episodes: z.number().nullish(),
  start_season: malStartSeason.nullish(),
  broadcast: malBroadcast.nullish(),
  source: z.string().nullish(),
  average_episode_duration: z.number().nullish(),
  studios: z.array(malStudio).nullish(),
});

export type MalAnime = z.infer<typeof malAnime>;

export const malPaged = z.object({
  data: z.array(z.object({ node: malAnime })),
  paging: z.object({ next: z.string().optional() }).optional(),
});

/** Every field we ask MAL for. Requesting less costs an extra round trip. */
export const MAL_ANIME_FIELDS = [
  "id",
  "title",
  "main_picture",
  "alternative_titles",
  "start_date",
  "end_date",
  "synopsis",
  "media_type",
  "status",
  "num_episodes",
  "start_season",
  "broadcast",
  "source",
  "average_episode_duration",
  "studios",
].join(",");
