import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/server/sources/mal/ratelimit";

describe("RateLimiter", () => {
  it("spends its burst, then paces at the configured rate", async () => {
    let now = 0;
    const slept: number[] = [];
    const limiter = new RateLimiter(
      2,
      2,
      () => now,
      async (ms) => {
        slept.push(ms);
        now += ms;
      },
    );

    await limiter.acquire();
    await limiter.acquire();
    expect(slept).toEqual([]);

    await limiter.acquire();
    expect(slept).toEqual([500]);
  });

  it("refuses a nonsense rate rather than hammering MAL", () => {
    expect(() => new RateLimiter(0)).toThrow();
  });
});
