import type { Prisma, PrismaClient, SourceType } from "@prisma/client";
import { applyIngest } from "./provenance";
import { slugify } from "./slug";
import type { SourceAnime, SourceSeason } from "./types";

type Tx = Prisma.TransactionClient;

export interface IngestResult {
  animeId: string;
  seasonIds: string[];
  created: boolean;
  skippedOwnedFields: string[];
}

/**
 * Idempotent upsert of one provider entry onto our canonical model.
 *
 * Resolution order matters: we look the entry up by its ExternalIdMapping, so
 * a re-run maps onto the same records even if titles changed on the provider
 * side. Nothing here matches on title, ever — that is how duplicate catalog
 * entries get created.
 */
export async function ingestAnime(
  prisma: PrismaClient,
  source: SourceAnime,
  provider: SourceType,
  now: Date = new Date(),
): Promise<IngestResult> {
  return prisma.$transaction(async (tx) => {
    await storePayload(tx, source, provider, now);

    const existing = await tx.externalIdMapping.findUnique({
      where: {
        provider_providerEntityType_providerId: {
          provider,
          providerEntityType: source.providerEntityType,
          providerId: source.providerId,
        },
      },
      include: { season: { select: { animeId: true } } },
    });

    const animeId =
      existing?.animeId ?? existing?.season?.animeId ?? undefined;

    const skipped: string[] = [];
    const animeFields = {
      format: source.format,
      status: source.status,
      synopsis: source.synopsis,
      coverImage: source.coverImage,
      startDate: source.startDate,
      endDate: source.endDate,
      sourceMedia: source.sourceMedia,
    };

    let resolvedAnimeId: string;
    let created = false;

    if (animeId) {
      const current = await tx.anime.findUniqueOrThrow({
        where: { id: animeId },
        select: { fieldProvenance: true },
      });
      const { data, skipped: s } = applyIngest(
        current.fieldProvenance,
        animeFields,
        provider,
        now,
      );
      skipped.push(...s);
      await tx.anime.update({ where: { id: animeId }, data });
      resolvedAnimeId = animeId;
    } else {
      const { data } = applyIngest(null, animeFields, provider, now);
      const primary =
        source.titles.find((t) => t.isPrimary)?.text ?? source.providerId;
      const anime = await tx.anime.create({
        data: {
          ...data,
          slug: await uniqueSlug(tx, slugify(primary)),
          provenance: provider,
        },
      });
      resolvedAnimeId = anime.id;
      created = true;

      await tx.externalIdMapping.create({
        data: {
          provider,
          providerEntityType: source.providerEntityType,
          providerId: source.providerId,
          targetType: "ANIME",
          animeId: resolvedAnimeId,
        },
      });
    }

    for (const title of source.titles) {
      await tx.title.upsert({
        where: {
          animeId_text_language: {
            animeId: resolvedAnimeId,
            text: title.text,
            language: title.language,
          },
        },
        create: {
          animeId: resolvedAnimeId,
          text: title.text,
          language: title.language,
          type: title.type,
          isPrimary: title.isPrimary,
          provenance: provider,
        },
        // Titles are provider content stored verbatim; we only ever add.
        update: {},
      });
    }

    const seasonIds: string[] = [];
    for (const season of source.seasons) {
      seasonIds.push(
        await ingestSeason(tx, resolvedAnimeId, season, provider, now, skipped),
      );
    }

    return { animeId: resolvedAnimeId, seasonIds, created, skippedOwnedFields: skipped };
  });
}

async function ingestSeason(
  tx: Tx,
  animeId: string,
  source: SourceSeason,
  provider: SourceType,
  now: Date,
  skipped: string[],
): Promise<string> {
  const mapping = await tx.externalIdMapping.findUnique({
    where: {
      provider_providerEntityType_providerId: {
        provider,
        providerEntityType: "season",
        providerId: source.providerId,
      },
    },
  });

  const fields = {
    title: source.title,
    part: source.part,
    partNumber: source.partNumber,
    seasonName: source.seasonName,
    seasonYear: source.seasonYear,
    episodeCount: source.episodeCount,
    status: source.status,
    startDate: source.startDate,
    endDate: source.endDate,
    broadcastWeekdayJst: source.broadcastWeekdayJst,
    broadcastTimeJst: source.broadcastTimeJst,
    studios: source.studios,
  };

  let seasonId: string;

  if (mapping?.seasonId) {
    const current = await tx.season.findUniqueOrThrow({
      where: { id: mapping.seasonId },
      select: { fieldProvenance: true },
    });
    const { data, skipped: s } = applyIngest(
      current.fieldProvenance,
      fields,
      provider,
      now,
    );
    skipped.push(...s);
    await tx.season.update({ where: { id: mapping.seasonId }, data });
    seasonId = mapping.seasonId;
  } else {
    const last = await tx.season.findFirst({
      where: { animeId },
      orderBy: { ordinal: "desc" },
      select: { ordinal: true },
    });
    const { data } = applyIngest(null, fields, provider, now);
    const season = await tx.season.create({
      data: {
        ...data,
        anime: { connect: { id: animeId } },
        ordinal: (last?.ordinal ?? 0) + 1,
        provenance: provider,
      },
    });
    seasonId = season.id;

    await tx.externalIdMapping.create({
      data: {
        provider,
        providerEntityType: "season",
        providerId: source.providerId,
        targetType: "SEASON",
        seasonId,
      },
    });
  }

  for (const episode of source.episodes) {
    const episodeFields = {
      absoluteNumber: episode.absoluteNumber,
      countsTowardProgress: episode.countsTowardProgress,
      titleEn: episode.titleEn,
      titleJa: episode.titleJa,
      titleRomaji: episode.titleRomaji,
      synopsis: episode.synopsis,
      runtimeMins: episode.runtimeMins,
      airedAt: episode.airedAt,
    };

    const current = await tx.episode.findUnique({
      where: {
        seasonId_type_numberInSeason: {
          seasonId,
          type: episode.type,
          numberInSeason: episode.numberInSeason,
        },
      },
      select: { id: true, fieldProvenance: true },
    });

    if (current) {
      const { data, skipped: s } = applyIngest(
        current.fieldProvenance,
        episodeFields,
        episode.provenance,
        now,
      );
      skipped.push(...s);
      await tx.episode.update({ where: { id: current.id }, data });
    } else {
      const { data } = applyIngest(null, episodeFields, episode.provenance, now);
      await tx.episode.create({
        data: {
          ...data,
          season: { connect: { id: seasonId } },
          numberInSeason: episode.numberInSeason,
          type: episode.type,
          provenance: episode.provenance,
        },
      });
    }
  }

  return seasonId;
}

async function storePayload(
  tx: Tx,
  source: SourceAnime,
  provider: SourceType,
  now: Date,
): Promise<void> {
  const body = source.raw as Prisma.InputJsonValue;
  await tx.externalPayload.upsert({
    where: {
      provider_providerEntityType_providerId: {
        provider,
        providerEntityType: source.providerEntityType,
        providerId: source.providerId,
      },
    },
    create: {
      provider,
      providerEntityType: source.providerEntityType,
      providerId: source.providerId,
      fetchedAt: now,
      body,
    },
    update: { fetchedAt: now, body },
  });
}

async function uniqueSlug(tx: Tx, base: string): Promise<string> {
  for (let n = 0; n < 50; n++) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const clash = await tx.anime.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
