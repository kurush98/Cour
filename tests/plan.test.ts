import { describe, expect, it } from "vitest";
import { planWrites, wouldChange } from "@/server/catalog/plan";
import { claimOwnership } from "@/server/catalog/provenance";

const NOW = new Date("2026-09-20T00:00:00.000Z");

type Fields = { titleEn?: string; runtimeMins?: number; airedAt?: Date };

function incoming(key: number, fields: Fields) {
  return { key, fields, provenance: "MERGED" as const };
}

describe("wouldChange", () => {
  it("ignores bookkeeping fields", () => {
    expect(
      wouldChange(
        { id: "a", titleEn: "x" },
        { titleEn: "x", fieldProvenance: { a: 1 }, lastSyncedAt: NOW },
      ),
    ).toBe(false);
  });

  it("compares dates by instant, not identity", () => {
    const current = { id: "a", airedAt: new Date("2024-07-06T14:30:00Z") };
    expect(wouldChange(current, { airedAt: new Date("2024-07-06T14:30:00Z") })).toBe(false);
    expect(wouldChange(current, { airedAt: new Date("2024-07-13T14:30:00Z") })).toBe(true);
  });

  it("compares arrays by contents", () => {
    expect(wouldChange({ id: "a", studios: ["MAPPA"] }, { studios: ["MAPPA"] })).toBe(false);
    expect(wouldChange({ id: "a", studios: ["MAPPA"] }, { studios: ["Bones"] })).toBe(true);
  });
});

describe("planWrites", () => {
  it("creates everything on a first run", () => {
    const plan = planWrites<Fields, number>({
      existing: [],
      incoming: [incoming(1, { titleEn: "One" }), incoming(2, { titleEn: "Two" })],
      keyOf: (row) => row["n"] as number,
      now: NOW,
    });
    expect(plan.creates).toHaveLength(2);
    expect(plan.updates).toHaveLength(0);
    expect(plan.creates[0]?.provenance).toBe("MERGED");
  });

  it("writes NOTHING when a re-run changes nothing — the point of the rewrite", () => {
    const plan = planWrites<Fields, number>({
      existing: [
        { id: "a", n: 1, titleEn: "One", fieldProvenance: {} },
        { id: "b", n: 2, titleEn: "Two", fieldProvenance: {} },
      ],
      incoming: [incoming(1, { titleEn: "One" }), incoming(2, { titleEn: "Two" })],
      keyOf: (row) => row["n"] as number,
      now: NOW,
    });
    expect(plan.creates).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toBe(2);
  });

  it("updates only the rows that actually differ", () => {
    const plan = planWrites<Fields, number>({
      existing: [
        { id: "a", n: 1, titleEn: "One", fieldProvenance: {} },
        { id: "b", n: 2, titleEn: "Two", fieldProvenance: {} },
      ],
      incoming: [incoming(1, { titleEn: "One" }), incoming(2, { titleEn: "Two!" })],
      keyOf: (row) => row["n"] as number,
      now: NOW,
    });
    expect(plan.unchanged).toBe(1);
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.id).toBe("b");
  });

  it("still refuses to touch a field we own", () => {
    const plan = planWrites<Fields, number>({
      existing: [
        {
          id: "a",
          n: 1,
          titleEn: "Our better title",
          fieldProvenance: claimOwnership(null, ["titleEn"], NOW),
        },
      ],
      incoming: [incoming(1, { titleEn: "MAL would clobber this" })],
      keyOf: (row) => row["n"] as number,
      now: NOW,
    });
    expect(plan.skippedOwnedFields).toEqual(["titleEn"]);
    expect(plan.updates).toHaveLength(0);
    expect(plan.unchanged).toBe(1);
  });

  it("matches on composite keys, so a special and a standard ep 1 stay distinct", () => {
    const plan = planWrites<Fields, { type: string; n: number }>({
      existing: [
        { id: "a", type: "STANDARD", n: 1, titleEn: "Ep 1", fieldProvenance: {} },
      ],
      incoming: [
        { key: { type: "STANDARD", n: 1 }, fields: { titleEn: "Ep 1" }, provenance: "MERGED" },
        { key: { type: "SPECIAL", n: 1 }, fields: { titleEn: "OVA" }, provenance: "MERGED" },
      ],
      keyOf: (row) => ({ type: row["type"] as string, n: row["n"] as number }),
      now: NOW,
    });
    expect(plan.unchanged).toBe(1);
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0]?.key).toEqual({ type: "SPECIAL", n: 1 });
  });
});
