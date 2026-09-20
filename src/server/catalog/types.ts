import type {
  AnimeFormat,
  AnimeStatus,
  EpisodeType,
  SeasonName,
  SeasonPart,
  SourceType,
  TitleLanguage,
  TitleType,
} from "@prisma/client";

/**
 * The provider-agnostic shape every catalog source maps onto.
 *
 * MAL is an implementation of this interface, never the interface itself
 * (D-013). Given that MAL may terminate access at will and our right to keep
 * serving cached data afterwards is undefined, this boundary is the thing
 * that makes a bad outcome an adapter change rather than a rewrite.
 */

export interface SourceTitle {
  text: string;
  language: TitleLanguage;
  type: TitleType;
  isPrimary: boolean;
}

export interface SourceEpisode {
  /** Provider's own episode id, when it has one. MAL does not. */
  providerId?: string;
  numberInSeason: number;
  absoluteNumber?: number;
  type: EpisodeType;
  countsTowardProgress: boolean;
  titleEn?: string;
  titleJa?: string;
  titleRomaji?: string;
  synopsis?: string;
  runtimeMins?: number;
  airedAt?: Date;
  /**
   * Where each field came from. Episodes synthesised from a broadcast rule
   * are MERGED, not MAL: they are derived, not verbatim provider values.
   */
  provenance: SourceType;
}

export interface SourceSeason {
  providerId: string;
  ordinal: number;
  title?: string;
  part: SeasonPart;
  partNumber?: number;
  seasonName?: SeasonName;
  seasonYear?: number;
  episodeCount?: number;
  status: AnimeStatus;
  startDate?: Date;
  endDate?: Date;
  broadcastWeekdayJst?: number;
  broadcastTimeJst?: string;
  studios: string[];
  episodes: SourceEpisode[];
}

export interface SourceAnime {
  providerId: string;
  providerEntityType: string;
  titles: SourceTitle[];
  format: AnimeFormat;
  status: AnimeStatus;
  synopsis?: string;
  coverImage?: string;
  startDate?: Date;
  endDate?: Date;
  sourceMedia?: string;
  seasons: SourceSeason[];
  /** Raw provider response, stored so re-mapping costs no API calls (D-014). */
  raw: unknown;
}

export interface CatalogSource {
  readonly provider: SourceType;
  fetchSeason(year: number, season: SeasonName): Promise<SourceAnime[]>;
  fetchAnime(providerId: string): Promise<SourceAnime>;
}
