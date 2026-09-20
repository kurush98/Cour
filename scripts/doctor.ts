/**
 * Checks the local setup and says, in plain terms, what is missing and how to
 * fix it. Run it whenever something does not work.
 */
import { existsSync, readFileSync } from "node:fs";
import { Client } from "pg";

type Check = { name: string; ok: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
}

function envValue(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

async function main(): Promise<void> {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  record(
    "Node.js 20 or newer",
    major >= 20,
    major >= 20
      ? `found v${process.versions.node}`
      : `found v${process.versions.node} — install the current LTS from nodejs.org`,
  );

  record(
    ".env file exists",
    existsSync(".env"),
    existsSync(".env")
      ? "found"
      : "missing — copy .env.example to .env and fill it in",
  );

  const dbUrl = envValue("DATABASE_URL");
  const directUrl = envValue("DIRECT_DATABASE_URL");

  record(
    "DATABASE_URL is set",
    Boolean(dbUrl),
    dbUrl ? "set" : "missing — the POOLED Neon connection string",
  );

  record(
    "DATABASE_URL is the pooled connection",
    !dbUrl || dbUrl.includes("-pooler"),
    !dbUrl
      ? "skipped"
      : dbUrl.includes("-pooler")
        ? "correct"
        : "this looks like the DIRECT string. Use the one whose host contains " +
          "'-pooler', or the app will exhaust Neon's connection limit",
  );

  record(
    "DIRECT_DATABASE_URL is set",
    Boolean(directUrl),
    directUrl ? "set" : "missing — the DIRECT (non-pooled) Neon string",
  );

  const clientId = envValue("MAL_CLIENT_ID");
  record(
    "MAL_CLIENT_ID is set",
    Boolean(clientId),
    clientId
      ? "set"
      : "missing — create one at https://myanimelist.net/apiconfig (non-commercial)",
  );

  if (existsSync(".env")) {
    const committed = readFileSync(".gitignore", "utf8").includes(".env");
    record(
      ".env is git-ignored",
      committed,
      committed ? "yes" : "NO — your secrets would be committed. Fix .gitignore",
    );
  }

  if (directUrl) {
    const client = new Client({ connectionString: directUrl });
    try {
      await client.connect();
      const tables = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM information_schema.tables
         WHERE table_schema = 'public'`,
      );
      const count = Number.parseInt(tables.rows[0]?.count ?? "0", 10);
      record("Database reachable", true, "connected");
      record(
        "Migrations applied",
        count > 0,
        count > 0 ? `${count} tables` : "no tables — run: npm run db:migrate",
      );

      if (count > 0) {
        const constraints = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM pg_constraint
           WHERE conname LIKE '%_exactly_one_target'`,
        );
        const applied = Number.parseInt(constraints.rows[0]?.count ?? "0", 10);
        record(
          "Hand-written SQL applied",
          applied >= 2,
          applied >= 2 ? "constraints present" : "missing — run: npm run db:sql",
        );
      }
      await client.end();
    } catch (error) {
      record(
        "Database reachable",
        false,
        `could not connect: ${(error as Error).message}`,
      );
    }
  }

  const width = Math.max(...checks.map((c) => c.name.length));
  process.stdout.write("\n");
  for (const check of checks) {
    process.stdout.write(
      `${check.ok ? "  ok  " : " FAIL "} ${check.name.padEnd(width)}  ${check.detail}\n`,
    );
  }

  const failed = checks.filter((c) => !c.ok);
  process.stdout.write(
    failed.length === 0
      ? "\nEverything looks right. Next: npm run backfill\n"
      : `\n${failed.length} thing(s) to fix, listed above.\n`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`doctor failed: ${(error as Error).message}\n`);
  process.exit(1);
});
