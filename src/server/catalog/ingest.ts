import type {
  EpisodeType,
  Prisma,
  PrismaClient,
  SourceType,
} from "@prisma/client";
import { planWrites } from "./plan";
import { applyIngest } from "./provenance";
import { slugify } from "./slug";
import type { SourceAnime, SourceSeason } from "./types";

type Tx = Prisma.TransactionClient;

type EpisodeKey = { type: EpisodeType; numberInSeason: number };

type EpisodeFields = {
  absoluteNumber?: number;
  countsTowardProgress: boolean;
  titleEn?: string;
  titleJa?: string;
  titleRomaji?: string;
  synopsis?: string;
  runtimeMins?: number;
  airedAt?: Date;
};

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
  return prisma.$transaction(
    async (tx) => {
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

      // Titles are provider content stored verbatim: we only ever add, never
      // edit. One read and one bulk insert rather than an upsert per title.
      const existingTitles = await tx.title.findMany({
        where: { animeId: resolvedAnimeId },
        select: { text: true, language: true },
      });
      const haveTitle = new Set(
        existingTitles.map((t) => `${t.language}::${t.text}`),
      );
      const newTitles = source.titles.filter(
        (t) => !haveTitle.has(`${t.language}::${t.text}`),
      );
      if (newTitles.length > 0) {
        await tx.title.createMany({
          data: newTitles.map((t) => ({
            animeId: resolvedAnimeId,
            text: t.text,
            language: t.language,
            type: t.type,
            isPrimary: t.isPrimary,
            provenance: provider,
          })),
          skipDuplicates: true,
        });
      }

      const seasonIds: string[] = [];
      for (const season of source.seasons) {
        seasonIds.push(
          await ingestSeason(tx, resolvedAnimeId, season, provider, now, skipped),
        );
      }

      return { animeId: resolvedAnimeId, seasonIds, created, skippedOwnedFields: skipped };
    },
    // Interactive transactions default to a five second timeout. A season
    // with a few hundred episodes on a slow link legitimately exceeds that,
    // and a partial ingest is worse than a slow one.
    { timeout: 30_000, maxWait: 10_000 },
  );
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

  await ingestEpisodes(tx, seasonId, source, now, skipped);

  return seasonId;
}

/**
 * Writes a season's episodes in three queries instead of two per episode.
 *
 * A five-season backfill is roughly 20,000 episodes. Read-then-write per row
 * is ~40,000 sequential round trips to a hosted Postgres, which is where the
 * backfill's runtime went. This reads once, inserts new rows in one call, and
 * updates only the rows whose values actually differ — so a re-run of an
 * unchanged season writes nothing at all.
 */
async function ingestEpisodes(
  tx: Tx,
  seasonId: string,
  source: SourceSeason,
  now: Date,
  skipped: string[],
): Promise<void> {
  if (source.episodes.length === 0) return;

  const existing = await tx.episode.findMany({
    where: { seasonId },
    select: {
      id: true,
      type: true,
      numberInSeason: true,
      fieldProvenance: true,
      absoluteNumber: true,
      countsTowardProgress: true,
      titleEn: true,
      titleJa: true,
      titleRomaji: true,
      synopsis: true,
      runtimeMins: true,
      airedAt: true,
    },
  });

  const plan = planWrites<EpisodeFields, EpisodeKey>({
    existing,
    incoming: source.episodes.map((episode) => ({
      key: { type: episode.type, numberInSeason: episode.numberInSeason },
      provenance: episode.provenance,
      fields: {
        absoluteNumber: episode.absoluteNumber,
        countsTowardProgress: episode.countsTowardProgress,
        titleEn: episode.titleEn,
        titleJa: episode.titleJa,
        titleRomaji: episode.titleRomaji,
        synopsis: episode.synopsis,
        runtimeMins: episode.runtimeMins,
        airedAt: episode.airedAt,
      },
    })),
    keyOf: (row) => ({
      type: row["type"] as EpisodeType,
      numberInSeason: row["numberInSeason"] as number,
    }),
    now,
  });

  skipped.push(...plan.skippedOwnedFields);

  if (plan.creates.length > 0) {
    await tx.episode.createMany({
      data: plan.creates.map((create) => ({
        ...create.data,
        seasonId,
        type: create.key.type,
        numberInSeason: create.key.numberInSeason,
        provenance: create.provenance,
      })),
      skipDuplicates: true,
    });
  }

  // Sequential by necessity — Prisma has no bulk update with per-row values —
  // but on a steady-state sync this list is almost always empty.
  for (const update of plan.updates) {
    await tx.episode.update({ where: { id: update.id }, data: update.data });
  }
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
