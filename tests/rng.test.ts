import { describe, expect, it } from "vitest";
import { Rng } from "../src/sim/rng.js";

describe("Rng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it("differs across seeds", () => {
    expect(new Rng(1).nextU32()).not.toBe(new Rng(2).nextU32());
  });

  it("int stays in range", () => {
    const r = new Rng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
    }
  });
});
