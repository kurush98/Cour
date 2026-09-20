import type { PrismaClient, SourceType } from "@prisma/client";
import { fieldsFromSource } from "./provenance";

/**
 * Obligations from the MAL API agreement, implemented as operations rather
 * than left as a promise in a document.
 *
 *  - §3(e): when content is removed on the provider's side, we have 24 hours
 *    from a request to mirror that. `purgeProviderEntity` is the operator
 *    path for exactly that, and it must not need a deploy.
 *  - §18: they may demand a written report of our current deployment of their
 *    content. `provenanceReport` is that report.
 */

export interface PurgeResult {
  provider: SourceType;
  providerId: string;
  found: boolean;
  deletedAnime: number;
  deletedSeasons: number;
  deletedEpisodes: number;
  deletedPayloads: number;
}

/**
 * Remove everything traceable to one provider entity.
 *
 * Note what this deliberately does NOT delete: our users' logs, ratings and
 * reviews are ours and theirs, not the provider's. If an episode row goes,
 * the cascade takes the logs attached to it, so a purge that would destroy
 * user data requires `allowUserDataLoss` to be set explicitly — an operator
 * should have to mean it.
 */
export async function purgeProviderEntity(
  prisma: PrismaClient,
  args: {
    provider: SourceType;
    providerEntityType: string;
    providerId: string;
    allowUserDataLoss?: boolean;
  },
): Promise<PurgeResult> {
  const base: PurgeResult = {
    provider: args.provider,
    providerId: args.providerId,
    found: false,
    deletedAnime: 0,
    deletedSeasons: 0,
    deletedEpisodes: 0,
    deletedPayloads: 0,
  };

  return prisma.$transaction(async (tx) => {
    const mapping = await tx.externalIdMapping.findUnique({
      where: {
        provider_providerEntityType_providerId: {
          provider: args.provider,
          providerEntityType: args.providerEntityType,
          providerId: args.providerId,
        },
      },
    });

    const payloads = await tx.externalPayload.deleteMany({
      where: {
        provider: args.provider,
        providerEntityType: args.providerEntityType,
        providerId: args.providerId,
      },
    });
    base.deletedPayloads = payloads.count;

    if (!mapping) return base;
    base.found = true;

    const episodeWhere = mapping.animeId
      ? { season: { animeId: mapping.animeId } }
      : mapping.seasonId
        ? { seasonId: mapping.seasonId }
        : { id: mapping.episodeId ?? "" };

    const affectedLogs = await tx.episodeLog.count({ where: { episode: episodeWhere } });
    const affectedRatings = await tx.episodeRating.count({
      where: { episode: episodeWhere },
    });

    if ((affectedLogs > 0 || affectedRatings > 0) && !args.allowUserDataLoss) {
      throw new Error(
        `Purging ${args.provider}:${args.providerId} would destroy ` +
          `${affectedLogs} logs and ${affectedRatings} ratings. ` +
          `Re-run with allowUserDataLoss to confirm.`,
      );
    }

    if (mapping.episodeId) {
      await tx.episode.delete({ where: { id: mapping.episodeId } });
      base.deletedEpisodes = 1;
    } else if (mapping.seasonId) {
      const episodes = await tx.episode.deleteMany({
        where: { seasonId: mapping.seasonId },
      });
      await tx.season.delete({ where: { id: mapping.seasonId } });
      base.deletedEpisodes = episodes.count;
      base.deletedSeasons = 1;
    } else if (mapping.animeId) {
      const seasons = await tx.season.findMany({
        where: { animeId: mapping.animeId },
        select: { id: true },
      });
      const episodes = await tx.episode.deleteMany({
        where: { seasonId: { in: seasons.map((s) => s.id) } },
      });
      await tx.anime.delete({ where: { id: mapping.animeId } });
      base.deletedEpisodes = episodes.count;
      base.deletedSeasons = seasons.length;
      base.deletedAnime = 1;
    }

    return base;
  });
}

export interface ProvenanceReportRow {
  animeId: string;
  slug: string;
  fieldsFromProvider: string[];
  seasonCount: number;
  episodeCount: number;
}

/** "What of yours are we currently deploying?" — answerable by query. */
export async function provenanceReport(
  prisma: PrismaClient,
  provider: SourceType,
): Promise<ProvenanceReportRow[]> {
  const anime = await prisma.anime.findMany({
    where: { mappings: { some: { provider } } },
    select: {
      id: true,
      slug: true,
      fieldProvenance: true,
      _count: { select: { seasons: true } },
      seasons: { select: { _count: { select: { episodes: true } } } },
    },
  });

  return anime.map((a) => ({
    animeId: a.id,
    slug: a.slug,
    fieldsFromProvider: fieldsFromSource(a.fieldProvenance, provider),
    seasonCount: a._count.seasons,
    episodeCount: a.seasons.reduce((sum, s) => sum + s._count.episodes, 0),
  }));
}
