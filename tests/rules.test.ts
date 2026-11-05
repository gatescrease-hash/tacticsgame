import { describe, expect, it } from "vitest";
import { content } from "../src/content/index.js";
import { runBattle, type Rules } from "../src/sim/index.js";

const ALL: Partial<Rules> = { unitStreams: true, hpScale: 150, damageSpread: 20, charge: true, underdog: 10 };

describe("combat rules", () => {
  it("every rule combination stays deterministic", () => {
    for (const rules of [{ unitStreams: true }, { damageSpread: 20 }, { charge: true }, { underdog: 10 }, ALL]) {
      const a = runBattle(content, "patrol", 5, { rules });
      const b = runBattle(content, "patrol", 5, { rules });
      expect(a.log).toEqual(b.log);
    }
  });

  it("hpScale scales max HP", () => {
    const start = (hpScale: number) => {
      const e = runBattle(content, "duel", 1, { rules: { hpScale } }).log[0]!;
      if (e.kind !== "start") throw new Error("no start");
      return e.units[0]!.maxHp;
    };
    expect(start(150)).toBe(Math.trunc((start(100) * 150) / 100));
  });

  it("charge lets a unit strike on the step that brings it into range", () => {
    let charged = false;
    for (let seed = 1; seed <= 5 && !charged; seed++) {
      const log = runBattle(content, "duel", seed, { rules: { charge: true } }).log;
      for (let i = 1; i < log.length; i++) {
        const e = log[i]!;
        // A move immediately followed (same tick, same unit, maybe after a shout) by an ability.
        if (e.kind === "ability" && !e.counter) {
          const before = log.slice(0, i).reverse().find((x) => x.kind !== "say");
          if (before?.kind === "move" && before.uid === e.uid && before.t === e.t) charged = true;
        }
      }
    }
    expect(charged).toBe(true);
  });

  it("per-unit streams keep battles that start identically correlated under tempo jitter", () => {
    // Not a strict guarantee, just a smoke check that streams change outcomes less than a full re-roll would.
    let same = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const a = runBattle(content, "skirmish", seed, { rules: { unitStreams: true } });
      const b = runBattle(content, "skirmish", seed, { rules: { unitStreams: true }, gaugeJitter: 5 });
      if (a.winner === b.winner) same++;
    }
    expect(same).toBeGreaterThan(10);
  });
});
