/**
 * Rating scale.
 *
 * Stored internally as an integer 1-100. Displayed as 5 stars in half-steps
 * (product decision Q3), which is the ten values 10, 20 ... 100.
 *
 * Storage is deliberately finer than display: a site that stores its display
 * scale cannot change granularity without migrating every rating ever cast
 * (D-008).
 */

export const INTERNAL_MIN = 1;
export const INTERNAL_MAX = 100;
export const STAR_STEPS = 10; // half-stars from 0.5 to 5.0
export const INTERNAL_PER_STEP = INTERNAL_MAX / STAR_STEPS;

export class RatingScaleError extends Error {}

/** 0.5 .. 5.0 in half-steps -> 10 .. 100 */
export function starsToInternal(stars: number): number {
  const steps = stars * 2;
  if (!Number.isInteger(steps) || steps < 1 || steps > STAR_STEPS) {
    throw new RatingScaleError(
      `Rating must be 0.5-5.0 in half-star steps, got ${stars}`,
    );
  }
  return steps * INTERNAL_PER_STEP;
}

/** 1 .. 100 -> nearest half-star, for display. */
export function internalToStars(internal: number): number {
  assertInternal(internal);
  return Math.round(internal / INTERNAL_PER_STEP) / 2;
}

export function assertInternal(value: number): void {
  if (!Number.isInteger(value) || value < INTERNAL_MIN || value > INTERNAL_MAX) {
    throw new RatingScaleError(
      `Internal rating must be an integer ${INTERNAL_MIN}-${INTERNAL_MAX}, got ${value}`,
    );
  }
}

/** Zero-based histogram bucket, one per half-star. */
export function histogramBucket(internal: number): number {
  assertInternal(internal);
  return Math.min(
    STAR_STEPS - 1,
    Math.max(0, Math.ceil(internal / INTERNAL_PER_STEP) - 1),
  );
}

/**
 * Bayesian shrinkage. Blends `priorVotes` votes of the global mean into every
 * score so a three-vote episode cannot display as a 10.
 *
 * Mandatory from launch, not Phase 4: early on, every episode is a low-sample
 * episode (roadmap §4, mechanism 2).
 */
export function bayesianMean(args: {
  sum: number;
  count: number;
  globalMean: number;
  priorVotes?: number;
}): number | null {
  const priorVotes = args.priorVotes ?? defaultPriorVotes();
  if (args.count <= 0 && priorVotes <= 0) return null;
  return (priorVotes * args.globalMean + args.sum) / (priorVotes + args.count);
}

/** Config, not code, so the prior can be tuned without a deploy (D-012). */
export function defaultPriorVotes(): number {
  const raw = process.env.RATING_BAYES_PRIOR_VOTES;
  const parsed = raw === undefined ? NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;
}

/**
 * A distribution is bimodal-ish when the extremes dominate the middle. Used
 * to decide when the UI must show the histogram rather than the mean — a
 * spike of 1s and 10s is self-documenting (roadmap §4, mechanism 3).
 */
export function isPolarised(histogram: readonly number[]): boolean {
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total < 10) return false;
  const low = (histogram[0] ?? 0) + (histogram[1] ?? 0);
  const high = (histogram[8] ?? 0) + (histogram[9] ?? 0);
  const middle = total - low - high;
  return low > 0 && high > 0 && low + high > middle;
}
