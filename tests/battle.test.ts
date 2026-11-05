import { describe, expect, it } from "vitest";
import { content, scenarioIds } from "../src/content/index.js";
import { formatLog, runBattle } from "../src/sim/index.js";

describe("runBattle", () => {
  it.each(scenarioIds)("%s: same setup + seed gives the same battle", (id) => {
    const a = runBattle(content, id, 123);
    const b = runBattle(content, id, 123);
    expect(a.log).toEqual(b.log);
  });

  it.each(scenarioIds)("%s: battles end with a winner within the tick limit", (id) => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = runBattle(content, id, seed);
      expect(r.log.at(-1)?.kind).toBe("end");
      expect(r.winner).not.toBe("draw");
    }
  });

  it("different seeds can produce different battles", () => {
    const logs = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) logs.add(JSON.stringify(runBattle(content, "duel", seed).log));
    expect(logs.size).toBeGreaterThan(1);
  });

  it("never puts two living units on the same tile", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const r = runBattle(content, "skirmish", seed);
      const start = r.log[0]!;
      if (start.kind !== "start") throw new Error("missing start");
      const pos = new Map(start.units.map((u) => [u.uid, `${u.pos.x},${u.pos.y}`]));
      const alive = new Set(start.units.map((u) => u.uid));
      for (const e of r.log) {
        if (e.kind === "knockout") alive.delete(e.uid);
        if (e.kind === "move") {
          pos.set(e.uid, `${e.to.x},${e.to.y}`);
          const taken = [...alive].map((uid) => pos.get(uid));
          expect(new Set(taken).size).toBe(taken.length);
        }
      }
    }
  });

  it("formats a readable text log", () => {
    const lines = formatLog(runBattle(content, "duel", 1).log);
    expect(lines[0]).toContain("Battle 'duel'");
    expect(lines.at(-1)).toMatch(/wins|Draw/);
  });
});
