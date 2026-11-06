import { pacingOf } from "../src/tools/pacing.js";
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

describe("commitment and the retreat clock", () => {
  const cautious = { nerve: 100, advance: 0 };
  const flips = (rules: Record<string, number>) => {
    let n = 0;
    for (const id of ["patrol", "marsh"]) for (let seed = 1; seed <= 4; seed++) n += pacingOf(runBattle(content, id, seed, { rules }).log).flip;
    return n;
  };

  it("commitment cuts ping-ponging", () => {
    // Cautious melee units no longer ping-pong (the back line may still hold and shuffle at range).
    expect(flips({ ...cautious, commit: 3, retreatLimit: 0 })).toBeLessThan(flips({ ...cautious, commit: 0, retreatLimit: 0 }) * 0.8);
    // At the default pacing rules, ping-pong is rare.
    expect(flips({})).toBeLessThan(flips({ ...cautious, commit: 0, retreatLimit: 0 }) / 3);
  });

  it("the retreat clock forces hovering units back in", () => {
    let shouts = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const log = runBattle(content, "patrol", seed, { rules: { ...cautious, commit: 0, retreatLimit: 30 } }).log;
      shouts += log.filter((e) => e.kind === "say" && /Enough running|No more hiding|Here I come|Now or never/.test(e.text)).length;
    }
    expect(shouts).toBeGreaterThan(0);
  });
});

describe("tactics and roles", () => {
  /** Kesh (reckless skirmisher, a flanker) in the Arago patrol: average tick he's knocked out at (battle end if never). */
  const keshLasts = (playerTactics: number) => {
    let total = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const log = runBattle(content, "patrol", seed, { rules: { playerTactics } }).log;
      const start = log[0]!;
      const kesh = start.kind === "start" ? start.units.find((u) => u.name === "Kesh")!.uid : -1;
      total += log.find((e) => e.kind === "knockout" && e.uid === kesh)?.t ?? log.at(-1)!.t;
    }
    return total / 6;
  };

  it("a trained flanker runs the flank instead of charging in", () => {
    // Reckless Kesh (tactics 10) dives in and drops early; trained to 70 he waits for the line and lasts far longer.
    expect(keshLasts(60)).toBeGreaterThan(2 * keshLasts(0));
  });

  it("tactics 0 means nobody plays a role", () => {
    const a = runBattle(content, "marsh", 3, { rules: { tactics: 0 } });
    const b = runBattle(content, "marsh", 3, { rules: { tactics: 0, playerTactics: 0, enemyTactics: -100 } });
    expect(a.log).toEqual(b.log);
  });
});
