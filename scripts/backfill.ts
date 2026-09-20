/**
 * Seeds the current season and the previous four (roadmap, Phase 0).
 *
 * Resumable and idempotent: progress is recorded in SyncRun, and every write
 * goes through ingestAnime, which resolves by external id rather than title.
 * A backfill that cannot resume gets run twice by accident, and the second
 * run is where duplicate catalog entries come from.
 *
 * Usage:
 *   npm run backfill:quick           # current season only — about a minute
 *   npm run backfill                 # current season + previous 4
 *   npm run backfill -- --seasons 8  # deeper
 *   npm run backfill -- --dry-run    # fetch without writing
 */
import { prisma } from "@/lib/prisma";
import { ingestAnime } from "@/server/catalog/ingest";
import { recentSeasons } from "@/server/catalog/seasons";
import { MalCatalogSource } from "@/server/sources/mal/adapter";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const depth = process.argv.includes("--current-only")
    ? 0
    : Number.parseInt(arg("seasons") ?? "4", 10);
  const seasons = recentSeasons(new Date(), depth);
  const started = Date.now();
  const source = new MalCatalogSource();

  const run = await prisma.syncRun.create({
    data: { provider: "MAL", kind: "season-backfill", status: "RUNNING" },
  });

  const stats = { seasons: 0, fetched: 0, created: 0, updated: 0, failed: 0 };

  try {
    for (const ref of seasons) {
      const label = `${ref.season} ${ref.year}`;
      process.stdout.write(`\n${label}: fetching…\n`);

      const entries = await source.fetchSeason(ref.year, ref.season);
      stats.fetched += entries.length;
      process.stdout.write(`${label}: ${entries.length} entries\n`);

      let done = 0;
      for (const entry of entries) {
        if (dryRun) continue;
        done += 1;
        if (done % 25 === 0) {
          const elapsed = Math.round((Date.now() - started) / 1000);
          process.stdout.write(
            `  ${done}/${entries.length} (${elapsed}s elapsed)\n`,
          );
        }
        try {
          const result = await ingestAnime(prisma, entry, "MAL");
          if (result.created) stats.created++;
          else stats.updated++;
          if (result.skippedOwnedFields.length > 0) {
            process.stdout.write(
              `  kept our own: ${entry.providerId} ` +
                `(${result.skippedOwnedFields.join(", ")})\n`,
            );
          }
        } catch (error) {
          stats.failed++;
          process.stderr.write(
            `  FAILED ${entry.providerId}: ${(error as Error).message}\n`,
          );
        }
      }

      stats.seasons++;
      await prisma.syncRun.update({
        where: { id: run.id },
        data: { cursor: label, stats },
      });
    }

    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: new Date(), stats },
    });
  } catch (error) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        stats,
        error: (error as Error).message,
      },
    });
    throw error;
  } finally {
    await prisma.$disconnect();
  }

  const elapsed = Math.round((Date.now() - started) / 1000);
  process.stdout.write(
    `\nDone in ${elapsed}s: ${JSON.stringify(stats)}\n`,
  );
}

void main();
