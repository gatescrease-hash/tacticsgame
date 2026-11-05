import { describe, expect, it } from "vitest";
import { content } from "../src/content/index.js";
import { settleBattle, type Difficulty } from "../src/sim/index.js";

const SAMPLES = 8;

describe("settled outcomes", () => {
  it("are deterministic", () => {
    const a = settleBattle(content, "skirmish", 3, {}, { samples: SAMPLES });
    const b = settleBattle(content, "skirmish", 3, {}, { samples: SAMPLES });
    expect(a.result.log).toEqual(b.result.log);
  });

  it("depend on the setup, not the seed", () => {
    const winners = new Set<string>();
    const shown = new Set<number>();
    for (let seed = 1; seed <= 6; seed++) {
      const r = settleBattle(content, "skirmish", seed, {}, { samples: SAMPLES });
      winners.add(r.result.winner);
      shown.add(r.seed);
    }
    expect(winners.size).toBe(1);
    // ...but the seed does vary which battle is shown.
    expect(shown.size).toBeGreaterThan(1);
  });

  it("the shown battle has the settled result", () => {
    for (const difficulty of ["easy", "normal", "hard"] as Difficulty[]) {
      const r = settleBattle(content, "duel", 1, {}, { samples: SAMPLES, difficulty });
      const expected = r.winProb >= { easy: 15, normal: 35, hard: 55 }[difficulty] ? "player" : "enemy";
      expect(r.result.winner).toBe(expected);
    }
  });

  it("easier difficulties never turn a win into a loss", () => {
    for (const enemyPower of [-20, 0, 20, 40]) {
      const won = (difficulty: Difficulty) =>
        settleBattle(content, "duel", 1, { enemyPower }, { samples: SAMPLES, difficulty }).result.winner === "player";
      if (won("hard")) expect(won("normal")).toBe(true);
      if (won("normal")) expect(won("easy")).toBe(true);
    }
  });
});
