import type {
  AnimeFormat,
  AnimeStatus,
  SeasonName,
  SourceType,
} from "@prisma/client";
import type {
  CatalogSource,
  SourceAnime,
  SourceEpisode,
  SourceSeason,
  SourceTitle,
} from "@/server/catalog/types";
import { MalClient } from "./client";
import type { MalAnime } from "./types";

const PROVIDER: SourceType = "MAL";

const FORMAT: Record<string, AnimeFormat> = {
  tv: "TV",
  tv_special: "SPECIAL",
  movie: "MOVIE",
  ova: "OVA",
  ona: "ONA",
  special: "SPECIAL",
  music: "MUSIC",
  unknown: "UNKNOWN",
};

const STATUS: Record<string, AnimeStatus> = {
  finished_airing: "FINISHED",
  currently_airing: "AIRING",
  not_yet_aired: "NOT_YET_AIRED",
};

const WEEKDAY: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const SEASON: Record<string, SeasonName> = {
  winter: "WINTER",
  spring: "SPRING",
  summer: "SUMMER",
  fall: "FALL",
};

/** MAL dates are "YYYY-MM-DD" or partial ("2024" / "2024-07"). */
export function parseMalDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value);
  if (!match) return undefined;
  const [, y, m, d] = match;
  return new Date(
    Date.UTC(Number(y), m ? Number(m) - 1 : 0, d ? Number(d) : 1, 0, 0, 0),
  );
}

/**
 * JST is UTC+9 year-round (Japan observes no DST), so the conversion is a
 * fixed offset. This is the one piece of timezone handling that is genuinely
 * simple; everything user-facing is not.
 */
export function jstToUtc(
  date: Date,
  timeJst: string | undefined,
): Date {
  const [hh, mm] = (timeJst ?? "00:00").split(":");
  const hours = Number.parseInt(hh ?? "0", 10);
  const minutes = Number.parseInt(mm ?? "0", 10);
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      hours - 9,
      minutes,
    ),
  );
}

/**
 * Synthesise the episode list.
 *
 * MAL API v2 has no episode endpoint: it gives a count and a weekly broadcast
 * slot and nothing else. So episodes are DERIVED — episode n airs one week
 * after episode n-1 at the same JST slot — and marked MERGED rather than MAL,
 * because they are computed, not verbatim provider values. MERGED fields stay
 * overwritable by a better source; OWN fields never are.
 *
 * This is a placeholder for real episode data, not a substitute for it. See
 * docs/phase-0/mal-api-gaps.md.
 */
export function synthesiseEpisodes(args: {
  episodeCount: number | null | undefined;
  startDate: Date | undefined;
  broadcastTimeJst: string | undefined;
  runtimeMins: number | undefined;
}): SourceEpisode[] {
  const count = args.episodeCount ?? 0;
  if (count <= 0 || !args.startDate) return [];

  const first = jstToUtc(args.startDate, args.broadcastTimeJst);
  const episodes: SourceEpisode[] = [];

  for (let n = 1; n <= count; n++) {
    const airedAt = new Date(first.getTime());
    airedAt.setUTCDate(airedAt.getUTCDate() + (n - 1) * 7);
    episodes.push({
      numberInSeason: n,
      absoluteNumber: n,
      type: "STANDARD",
      countsTowardProgress: true,
      runtimeMins: args.runtimeMins,
      airedAt,
      provenance: "MERGED",
    });
  }

  return episodes;
}

function titlesOf(node: MalAnime): SourceTitle[] {
  const titles: SourceTitle[] = [
    {
      text: node.title,
      language: "JA_ROMAJI",
      type: "OFFICIAL",
      isPrimary: true,
    },
  ];
  const alt = node.alternative_titles;
  if (alt?.en) {
    titles.push({ text: alt.en, language: "EN", type: "OFFICIAL", isPrimary: false });
  }
  if (alt?.ja) {
    titles.push({ text: alt.ja, language: "JA", type: "OFFICIAL", isPrimary: false });
  }
  for (const synonym of alt?.synonyms ?? []) {
    titles.push({
      text: synonym,
      language: "OTHER",
      type: "SYNONYM",
      isPrimary: false,
    });
  }

  // De-duplicate on the text alone, not on (text, language). MAL routinely
  // repeats the romaji title in `synonyms`, which arrives tagged OTHER and
  // would otherwise survive as a second row — the same title twice in search
  // results. First occurrence wins, and the list is ordered by authority.
  const seen = new Set<string>();
  return titles.filter((t) => {
    const key = t.text.trim().toLowerCase();
    if (key.length === 0 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * One MAL entry becomes one Anime with one Season.
 *
 * Split-cour merging is deliberately NOT attempted here. MAL gives no
 * reliable signal for it — "Part 2" in a title is a guess, and a wrong
 * automatic merge is far more expensive to unpick than a missing one. Merging
 * is a curation action (src/server/catalog/merge.ts) recorded as MANUAL.
 */
export function mapMalAnime(node: MalAnime): SourceAnime {
  const startDate = parseMalDate(node.start_date);
  const endDate = parseMalDate(node.end_date);
  const runtimeMins = node.average_episode_duration
    ? Math.round(node.average_episode_duration / 60)
    : undefined;
  const broadcastTimeJst = node.broadcast?.start_time ?? undefined;
  const weekday = node.broadcast?.day_of_the_week?.toLowerCase();
  const status = STATUS[node.status ?? ""] ?? "UNKNOWN";

  const season: SourceSeason = {
    providerId: String(node.id),
    ordinal: 1,
    part: "FULL",
    seasonName: node.start_season
      ? SEASON[node.start_season.season]
      : undefined,
    seasonYear: node.start_season?.year,
    episodeCount: node.num_episodes ?? undefined,
    status,
    startDate,
    endDate,
    broadcastWeekdayJst: weekday ? WEEKDAY[weekday] : undefined,
    broadcastTimeJst,
    studios: (node.studios ?? []).map((s) => s.name),
    episodes: synthesiseEpisodes({
      episodeCount: node.num_episodes,
      startDate,
      broadcastTimeJst,
      runtimeMins,
    }),
  };

  return {
    providerId: String(node.id),
    providerEntityType: "anime",
    titles: titlesOf(node),
    format: FORMAT[node.media_type ?? "unknown"] ?? "UNKNOWN",
    status,
    // Stored verbatim. Never translated, never edited (MAL §3(a)(xii)).
    synopsis: node.synopsis ?? undefined,
    coverImage: node.main_picture?.large ?? node.main_picture?.medium,
    startDate,
    endDate,
    sourceMedia: node.source ?? undefined,
    seasons: [season],
    raw: node,
  };
}

export class MalCatalogSource implements CatalogSource {
  readonly provider = PROVIDER;

  constructor(private readonly client: MalClient = new MalClient()) {}

  async fetchSeason(year: number, season: SeasonName): Promise<SourceAnime[]> {
    const nodes = await this.client.getSeason(
      year,
      season.toLowerCase() as "winter" | "spring" | "summer" | "fall",
    );
    return nodes.map(mapMalAnime);
  }

  async fetchAnime(providerId: string): Promise<SourceAnime> {
    return mapMalAnime(await this.client.getAnime(Number(providerId)));
  }
}
