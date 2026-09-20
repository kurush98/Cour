import { RateLimiter } from "./ratelimit";
import { MAL_ANIME_FIELDS, malAnime, malPaged, type MalAnime } from "./types";

const BASE_URL = "https://api.myanimelist.net/v2";

export class MalApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
  }
}

export interface MalClientOptions {
  clientId?: string;
  requestsPerSecond?: number;
  fetchImpl?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Typed MAL API v2 client.
 *
 * Never call this from a request path. Every user-facing read serves from our
 * own database (roadmap §2). Enforced by tests/architecture.test.ts.
 */
export class MalClient {
  private readonly clientId: string;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: MalClientOptions = {}) {
    const clientId = options.clientId ?? process.env.MAL_CLIENT_ID;
    if (!clientId) {
      throw new Error(
        "MAL_CLIENT_ID is not set. Get one at https://myanimelist.net/apiconfig — " +
          "it must never be shared or committed (MAL agreement §2(a)).",
      );
    }
    this.clientId = clientId;
    this.limiter = new RateLimiter(
      options.requestsPerSecond ??
        Number.parseFloat(process.env.MAL_REQUESTS_PER_SECOND ?? "1") ??
        1,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 4;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async request(url: string): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.acquire();

      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: {
            "X-MAL-CLIENT-ID": this.clientId,
            Accept: "application/json",
          },
        });
      } catch (error) {
        lastError = error;
        await this.backoff(attempt);
        continue;
      }

      if (response.ok) return response.json();

      const body = await response.text().catch(() => "");

      // 429 and 5xx are worth retrying; 4xx otherwise is our bug or a
      // revoked client id, and retrying just burns quota.
      if (response.status !== 429 && response.status < 500) {
        throw new MalApiError(
          `MAL API ${response.status} for ${url}`,
          response.status,
          body,
        );
      }

      lastError = new MalApiError(
        `MAL API ${response.status} for ${url}`,
        response.status,
        body,
      );
      await this.backoff(attempt);
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`MAL API request failed: ${String(lastError)}`);
  }

  private backoff(attempt: number): Promise<void> {
    return this.sleep(Math.min(16_000, 2 ** attempt * 1000));
  }

  async getAnime(id: number): Promise<MalAnime> {
    const url = `${BASE_URL}/anime/${id}?fields=${MAL_ANIME_FIELDS}`;
    return malAnime.parse(await this.request(url));
  }

  /** Paginates the whole season. MAL caps `limit` at 500. */
  async getSeason(
    year: number,
    season: "winter" | "spring" | "summer" | "fall",
    pageSize = 100,
  ): Promise<MalAnime[]> {
    const out: MalAnime[] = [];
    let url =
      `${BASE_URL}/anime/season/${year}/${season}` +
      `?limit=${pageSize}&offset=0&fields=${MAL_ANIME_FIELDS}`;

    for (;;) {
      const page = malPaged.parse(await this.request(url));
      for (const entry of page.data) out.push(entry.node);
      const next = page.paging?.next;
      if (!next) break;
      url = next;
    }

    return out;
  }
}
