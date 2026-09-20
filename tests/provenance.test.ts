import { describe, expect, it } from "vitest";
import {
  applyIngest,
  claimOwnership,
  fieldsFromSource,
  parseProvenance,
} from "@/server/catalog/provenance";

const NOW = new Date("2026-09-20T00:00:00.000Z");

describe("applyIngest", () => {
  it("writes provider fields onto a fresh row and stamps them", () => {
    const { data, skipped } = applyIngest(
      null,
      { synopsis: "from MAL", coverImage: "a.jpg" },
      "MAL",
      NOW,
    );
    expect(skipped).toEqual([]);
    expect(data.synopsis).toBe("from MAL");
    expect(data.fieldProvenance.synopsis).toEqual({
      source: "MAL",
      at: NOW.toISOString(),
    });
    expect(data.lastSyncedAt).toEqual(NOW);
  });

  it("NEVER overwrites a field we own — the rule the project rests on", () => {
    const existing = claimOwnership(null, ["synopsis"], NOW);
    const { data, skipped } = applyIngest(
      existing,
      { synopsis: "MAL would clobber this", coverImage: "b.jpg" },
      "MAL",
      NOW,
    );
    expect(skipped).toEqual(["synopsis"]);
    expect(data).not.toHaveProperty("synopsis");
    expect(data.coverImage).toBe("b.jpg");
    expect(data.fieldProvenance.synopsis?.source).toBe("OWN");
  });

  it("still overwrites MERGED fields — only OWN is protected", () => {
    const existing = { airedAt: { source: "MERGED", at: NOW.toISOString() } };
    const { data, skipped } = applyIngest(existing, { airedAt: "x" }, "ANNICT", NOW);
    expect(skipped).toEqual([]);
    expect(data.fieldProvenance.airedAt?.source).toBe("ANNICT");
  });

  it("ignores undefined so a sparse payload cannot blank existing data", () => {
    const { data } = applyIngest(
      null,
      { synopsis: undefined, coverImage: "c.jpg" },
      "MAL",
      NOW,
    );
    expect(data).not.toHaveProperty("synopsis");
    expect(Object.keys(data.fieldProvenance)).toEqual(["coverImage"]);
  });

  it("survives corrupt provenance JSON rather than throwing mid-backfill", () => {
    expect(parseProvenance("nonsense")).toEqual({});
    expect(parseProvenance([1, 2, 3])).toEqual({});
    expect(parseProvenance({ a: { source: 1 } })).toEqual({});
    const { data } = applyIngest("nonsense", { synopsis: "ok" }, "MAL", NOW);
    expect(data.synopsis).toBe("ok");
  });

  it("is idempotent: re-ingesting the same payload changes nothing but the stamp", () => {
    const first = applyIngest(null, { synopsis: "s" }, "MAL", NOW);
    const later = new Date(NOW.getTime() + 86_400_000);
    const second = applyIngest(first.data.fieldProvenance, { synopsis: "s" }, "MAL", later);
    expect(second.data.synopsis).toBe("s");
    expect(second.data.fieldProvenance.synopsis?.at).toBe(later.toISOString());
  });
});

describe("fieldsFromSource", () => {
  it("answers the audit question: what of theirs are we deploying", () => {
    let provenance = applyIngest(
      null,
      { synopsis: "mal", coverImage: "mal.jpg", sourceMedia: "manga" },
      "MAL",
      NOW,
    ).data.fieldProvenance;
    provenance = claimOwnership(provenance, ["synopsis"], NOW);

    expect(fieldsFromSource(provenance, "MAL").sort()).toEqual([
      "coverImage",
      "sourceMedia",
    ]);
    expect(fieldsFromSource(provenance, "OWN")).toEqual(["synopsis"]);
  });
});
