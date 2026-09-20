import { describe, expect, it } from "vitest";
import { previousSeason, recentSeasons, seasonOf } from "@/server/catalog/seasons";

describe("anime seasons", () => {
  it("maps months onto the four cours", () => {
    expect(seasonOf(new Date("2026-01-15Z")).season).toBe("WINTER");
    expect(seasonOf(new Date("2026-04-01Z")).season).toBe("SPRING");
    expect(seasonOf(new Date("2026-09-20Z")).season).toBe("SUMMER");
    expect(seasonOf(new Date("2026-12-31Z")).season).toBe("FALL");
  });

  it("walks back across the year boundary", () => {
    expect(previousSeason({ year: 2026, season: "WINTER" })).toEqual({
      year: 2025,
      season: "FALL",
    });
  });

  it("returns the current season plus the previous four, newest first", () => {
    const seasons = recentSeasons(new Date("2026-09-20Z"), 4);
    expect(seasons).toEqual([
      { year: 2026, season: "SUMMER" },
      { year: 2026, season: "SPRING" },
      { year: 2026, season: "WINTER" },
      { year: 2025, season: "FALL" },
      { year: 2025, season: "SUMMER" },
    ]);
  });
});
