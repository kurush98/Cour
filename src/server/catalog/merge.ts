import type { PrismaClient } from "@prisma/client";

/**
 * Curation: fold one Anime's seasons into another.
 *
 * This is the operation that makes the whole entry model work. MAL splits a
 * split-cour run into two entries; we ingest them as two Anime because no
 * automatic signal distinguishes "Part 2" from a genuine sequel, and a wrong
 * merge is much more expensive to unpick than a missing one. A curator then
 * merges them, and every external id follows.
 *
 * Deliberately NOT automatic. Recorded as MANUAL so we can always tell a
 * human judgment from an ingest guess.
 */
export async function mergeAnime(
  prisma: PrismaClient,
  args: { sourceAnimeId: string; targetAnimeId: string },
): Promise<{ movedSeasons: number; remappedIds: number }> {
  if (args.sourceAnimeId === args.targetAnimeId) {
    throw new Error("Cannot merge an anime into itself");
  }

  return prisma.$transaction(async (tx) => {
    const [source, target] = await Promise.all([
      tx.anime.findUniqueOrThrow({
        where: { id: args.sourceAnimeId },
        include: { seasons: { orderBy: { ordinal: "asc" } } },
      }),
      tx.anime.findUniqueOrThrow({
        where: { id: args.targetAnimeId },
        include: { seasons: { orderBy: { ordinal: "desc" }, take: 1 } },
      }),
    ]);

    if (source.seasons.some((s) => s.id === undefined)) {
      throw new Error("Unexpected season without an id");
    }

    let nextOrdinal = (target.seasons[0]?.ordinal ?? 0) + 1;
    for (const season of source.seasons) {
      await tx.season.update({
        where: { id: season.id },
        data: { animeId: args.targetAnimeId, ordinal: nextOrdinal },
      });
      nextOrdinal += 1;
    }

    // Anime-level external ids now point at the surviving record, and are
    // re-marked MANUAL: a human decided this, not an ingest.
    const remapped = await tx.externalIdMapping.updateMany({
      where: { animeId: args.sourceAnimeId },
      data: { animeId: args.targetAnimeId, mappedBy: "MANUAL" },
    });

    await tx.title.updateMany({
      where: { animeId: args.sourceAnimeId },
      data: { animeId: args.targetAnimeId },
    });

    await tx.anime.update({
      where: { id: args.targetAnimeId },
      data: { provenance: "MERGED" },
    });

    // Safe only because seasons, titles and mappings have all been re-parented
    // above; anything still attached would cascade away with it.
    await tx.anime.delete({ where: { id: args.sourceAnimeId } });

    return { movedSeasons: source.seasons.length, remappedIds: remapped.count };
  });
}

/**
 * Mark a season as one half of a split-cour run. Run after mergeAnime when
 * the two entries were parts rather than sequels.
 */
export async function markSplitCour(
  prisma: PrismaClient,
  seasonIds: string[],
): Promise<void> {
  await prisma.$transaction(
    seasonIds.map((id, index) =>
      prisma.season.update({
        where: { id },
        data: { part: "SPLIT_PART", partNumber: index + 1 },
      }),
    ),
  );
}
