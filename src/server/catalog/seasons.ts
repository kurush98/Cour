import type { SeasonName } from "@prisma/client";

const ORDER: SeasonName[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

export interface SeasonRef {
  year: number;
  season: SeasonName;
}

/** Anime seasons: Jan-Mar winter, Apr-Jun spring, Jul-Sep summer, Oct-Dec fall. */
export function seasonOf(date: Date): SeasonRef {
  const index = Math.floor(date.getUTCMonth() / 3);
  return { year: date.getUTCFullYear(), season: ORDER[index] ?? "WINTER" };
}

export function previousSeason(ref: SeasonRef): SeasonRef {
  const index = ORDER.indexOf(ref.season);
  return index === 0
    ? { year: ref.year - 1, season: "FALL" }
    : { year: ref.year, season: ORDER[index - 1] ?? "WINTER" };
}

/** The current season and the `count` before it, newest first. */
export function recentSeasons(from: Date, count: number): SeasonRef[] {
  const out: SeasonRef[] = [seasonOf(from)];
  for (let i = 0; i < count; i++) {
    const last = out[out.length - 1];
    if (!last) break;
    out.push(previousSeason(last));
  }
  return out;
}
