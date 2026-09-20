import { describe, expect, it } from "vitest";
import {
  jstToUtc,
  mapMalAnime,
  parseMalDate,
  synthesiseEpisodes,
} from "@/server/sources/mal/adapter";
import type { MalAnime } from "@/server/sources/mal/types";

describe("parseMalDate", () => {
  it("handles full, partial and missing dates", () => {
    expect(parseMalDate("2024-07-06")?.toISOString()).toBe("2024-07-06T00:00:00.000Z");
    expect(parseMalDate("2024-07")?.toISOString()).toBe("2024-07-01T00:00:00.000Z");
    expect(parseMalDate("2024")?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(parseMalDate(null)).toBeUndefined();
    expect(parseMalDate("not a date")).toBeUndefined();
  });
});

describe("jstToUtc", () => {
  it("shifts JST back nine hours", () => {
    const utc = jstToUtc(new Date(Date.UTC(2024, 6, 6)), "23:30");
    expect(utc.toISOString()).toBe("2024-07-06T14:30:00.000Z");
  });

  it("rolls back across the date line for early-morning JST slots", () => {
    // 01:30 JST Saturday is 16:30 UTC Friday — the case that breaks most
    // anime apps' "what aired this week" view.
    const utc = jstToUtc(new Date(Date.UTC(2024, 6, 6)), "01:30");
    expect(utc.toISOString()).toBe("2024-07-05T16:30:00.000Z");
  });
});

describe("synthesiseEpisodes", () => {
  const args = {
    episodeCount: 12,
    startDate: new Date(Date.UTC(2024, 6, 6)),
    broadcastTimeJst: "23:30",
    runtimeMins: 24,
  };

  it("lays episodes out one week apart from the first broadcast", () => {
    const episodes = synthesiseEpisodes(args);
    expect(episodes).toHaveLength(12);
    expect(episodes[0]?.airedAt?.toISOString()).toBe("2024-07-06T14:30:00.000Z");
    expect(episodes[11]?.airedAt?.toISOString()).toBe("2024-09-21T14:30:00.000Z");
  });

  it("marks them MERGED, not MAL — they are derived, not provider values", () => {
    for (const episode of synthesiseEpisodes(args)) {
      expect(episode.provenance).toBe("MERGED");
    }
  });

  it("produces nothing when MAL gives us no count or no start date", () => {
    expect(synthesiseEpisodes({ ...args, episodeCount: 0 })).toEqual([]);
    expect(synthesiseEpisodes({ ...args, episodeCount: null })).toEqual([]);
    expect(synthesiseEpisodes({ ...args, startDate: undefined })).toEqual([]);
  });
});

const NODE: MalAnime = {
  id: 52991,
  title: "Sousou no Frieren",
  main_picture: { medium: "m.jpg", large: "l.jpg" },
  alternative_titles: {
    en: "Frieren: Beyond Journey's End",
    ja: "葬送のフリーレン",
    synonyms: ["Frieren at the Funeral", "Sousou no Frieren"],
  },
  start_date: "2023-09-29",
  end_date: "2024-03-22",
  synopsis: "Elf mage Frieren…",
  media_type: "tv",
  status: "finished_airing",
  num_episodes: 28,
  start_season: { year: 2023, season: "fall" },
  broadcast: { day_of_the_week: "friday", start_time: "23:00" },
  source: "manga",
  average_episode_duration: 1440,
  studios: [{ id: 11, name: "Madhouse" }],
};

describe("mapMalAnime", () => {
  it("maps one MAL entry onto one Anime with one Season", () => {
    const mapped = mapMalAnime(NODE);
    expect(mapped.providerId).toBe("52991");
    expect(mapped.format).toBe("TV");
    expect(mapped.status).toBe("FINISHED");
    expect(mapped.seasons).toHaveLength(1);
    expect(mapped.seasons[0]?.seasonName).toBe("FALL");
    expect(mapped.seasons[0]?.broadcastWeekdayJst).toBe(5);
    expect(mapped.seasons[0]?.studios).toEqual(["Madhouse"]);
    expect(mapped.seasons[0]?.episodes).toHaveLength(28);
  });

  it("de-duplicates the romaji title MAL repeats as a synonym", () => {
    const titles = mapMalAnime(NODE).titles;
    const romaji = titles.filter((t) => t.text === "Sousou no Frieren");
    expect(romaji).toHaveLength(1);
    expect(romaji[0]?.isPrimary).toBe(true);
    expect(titles.map((t) => t.text)).toContain("Frieren: Beyond Journey's End");
    expect(titles.map((t) => t.text)).toContain("葬送のフリーレン");
  });

  it("keeps the synopsis verbatim — MAL §3(a)(xii) forbids altering it", () => {
    expect(mapMalAnime(NODE).synopsis).toBe(NODE.synopsis);
  });

  it("does not guess at split-cour merges", () => {
    // Two MAL entries stay two Anime. A curator merges them; an ingest that
    // guesses wrong is far more expensive to unpick.
    const part2 = mapMalAnime({ ...NODE, id: 99999, title: "Sousou no Frieren Part 2" });
    expect(part2.providerId).not.toBe(mapMalAnime(NODE).providerId);
  });

  it("carries the raw payload through for zero-cost re-mapping", () => {
    expect(mapMalAnime(NODE).raw).toBe(NODE);
  });
});
