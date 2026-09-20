import { describe, expect, it } from "vitest";
import {
  bayesianMean,
  histogramBucket,
  internalToStars,
  isPolarised,
  RatingScaleError,
  starsToInternal,
} from "@/lib/ratings";

describe("rating scale", () => {
  it("round-trips every half-star the UI can produce", () => {
    for (let steps = 1; steps <= 10; steps++) {
      const stars = steps / 2;
      expect(internalToStars(starsToInternal(stars))).toBe(stars);
    }
  });

  it("rejects values the UI cannot produce", () => {
    expect(() => starsToInternal(0)).toThrow(RatingScaleError);
    expect(() => starsToInternal(5.5)).toThrow(RatingScaleError);
    expect(() => starsToInternal(3.3)).toThrow(RatingScaleError);
  });

  it("keeps storage finer than display, so granularity can change later", () => {
    // 1-100 internal accepts values no current UI emits. That is the point.
    expect(internalToStars(37)).toBe(2);
    expect(histogramBucket(37)).toBe(3);
  });

  it("buckets each half-star into its own histogram slot", () => {
    expect(histogramBucket(10)).toBe(0);
    expect(histogramBucket(100)).toBe(9);
    expect(new Set([10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(histogramBucket)).size)
      .toBe(10);
  });
});

describe("bayesian shrinkage", () => {
  it("stops a three-vote episode displaying as a perfect score", () => {
    const shrunk = bayesianMean({
      sum: 300, // three 5-star ratings
      count: 3,
      globalMean: 65,
      priorVotes: 20,
    });
    expect(shrunk).not.toBeNull();
    expect(shrunk!).toBeLessThan(100);
    expect(internalToStars(Math.round(shrunk!))).toBeLessThan(4);
  });

  it("converges on the raw mean as volume grows", () => {
    const raw = 90;
    const many = bayesianMean({
      sum: raw * 5000,
      count: 5000,
      globalMean: 65,
      priorVotes: 20,
    });
    expect(Math.abs(many! - raw)).toBeLessThan(0.2);
  });
});

describe("polarisation", () => {
  it("flags a bimodal spike of 1s and 5s", () => {
    expect(isPolarised([40, 0, 0, 0, 0, 0, 0, 0, 0, 35])).toBe(true);
  });

  it("does not flag a normal distribution", () => {
    expect(isPolarised([0, 1, 3, 8, 20, 30, 22, 9, 3, 1])).toBe(false);
  });

  it("stays quiet on tiny samples, where shape means nothing", () => {
    expect(isPolarised([2, 0, 0, 0, 0, 0, 0, 0, 0, 2])).toBe(false);
  });
});
