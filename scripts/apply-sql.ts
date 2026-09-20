/**
 * Applies the hand-written SQL in prisma/sql/ in filename order.
 *
 * Exists so nobody needs psql installed to set this project up. Prisma cannot
 * express CHECK constraints, tsvector columns or trigram indexes (D-017), and
 * those are not optional extras — they hold the rating scale, the polymorphic
 * target invariants and title search.
 *
 * Every file is idempotent, so running this repeatedly is safe. Run it after
 * every `prisma migrate`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const SQL_DIR = "prisma/sql";

async function main(): Promise<void> {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No database URL. Set DIRECT_DATABASE_URL in .env — see .env.example.",
    );
  }

  const files = readdirSync(SQL_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    process.stdout.write("No SQL files to apply.\n");
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    for (const file of files) {
      process.stdout.write(`applying ${file} … `);
      // One query per file, simple protocol: keeps DO $$ blocks and
      // multi-statement files working as written.
      await client.query(readFileSync(join(SQL_DIR, file), "utf8"));
      process.stdout.write("ok\n");
    }
  } finally {
    await client.end();
  }

  process.stdout.write(`\nApplied ${files.length} file(s).\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`\nFailed: ${(error as Error).message}\n`);
  process.exit(1);
});
