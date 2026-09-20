import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * The roadmap's rule — "never hit MAL on a user request path" — is only as
 * real as something that fails when it is broken. This is that something.
 */
describe("architectural boundaries", () => {
  it("keeps the ingestion layer out of the request path", () => {
    const offenders = walk("src/app")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => /from\s+["']@\/server\/sources/.test(readFileSync(f, "utf8")));

    expect(
      offenders,
      "src/app must serve from our own database, never from a provider API",
    ).toEqual([]);
  });

  it("contains no reference to Jikan or any scraper", () => {
    // MAL §4(i) forbids scraping outright and requires content to come only
    // through the API. Jikan is a scraper: using it is a worse breach than
    // hitting the API would be.
    const offenders = walk("src")
      .concat(walk("scripts"))
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => /jikan|scrape|cheerio|puppeteer/i.test(readFileSync(f, "utf8")));

    expect(offenders, "no scraping, ever (MAL agreement §4(i))").toEqual([]);
  });

  it("has no MAL-list-import path", () => {
    // MAL §3(c): user-generated MAL content may not be stored server-side.
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(/model\s+MalImport|malListImport/i.test(schema)).toBe(false);
  });
});
