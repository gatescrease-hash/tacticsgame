import { describe, expect, it } from "vitest";
import { content, scenarioIds } from "../src/content/index.js";
import { formatLog, previewTurnOrder, runBattle } from "../src/sim/index.js";

describe("runBattle", () => {
  it.each(scenarioIds)("%s: same setup + seed gives the same battle", (id) => {
    const a = runBattle(content, id, 123, { recordQueue: true });
    const b = runBattle(content, id, 123, { recordQueue: true });
    expect(a.log).toEqual(b.log);
  });

  it.each(scenarioIds)("%s: battles end, and rarely in a draw", (id) => {
    let draws = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const r = runBattle(content, id, seed);
      expect(r.log.at(-1)?.kind).toBe("end");
      if (r.winner === "draw") draws++;
    }
    expect(draws).toBeLessThanOrEqual(2);
  });

  it("different seeds can produce different battles", () => {
    const logs = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) logs.add(JSON.stringify(runBattle(content, "duel", seed).log));
    expect(logs.size).toBeGreaterThan(1);
  });

  it("never puts two living units on the same tile", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const r = runBattle(content, "patrol", seed);
      const start = r.log[0]!;
      if (start.kind !== "start") throw new Error("missing start");
      const pos = new Map(start.units.map((u) => [u.uid, `${u.pos.x},${u.pos.y}`]));
      const alive = new Set(start.units.map((u) => u.uid));
      for (const e of r.log) {
        if (e.kind === "knockout") alive.delete(e.uid);
        if (e.kind === "move" || e.kind === "push") {
          pos.set(e.uid, `${e.to.x},${e.to.y}`);
          const taken = [...alive].map((uid) => pos.get(uid));
          expect(new Set(taken).size).toBe(taken.length);
        }
      }
    }
  });

  it("respects placements and benching", () => {
    const r = runBattle(content, "patrol", 1, { placements: { 0: { x: 0, y: 0 } }, benched: [1], rules: { formation: false } });
    const start = r.log[0]!;
    if (start.kind !== "start") throw new Error("missing start");
    expect(start.units[0]!.pos).toEqual({ x: 0, y: 0 });
    expect(start.units.some((u) => u.name === "Kesh")).toBe(false);
  });

  it("formation arranges the squad by role around the chosen spot", () => {
    const all = (p: { x: number; y: number }) => ({ 0: p, 1: p, 2: p, 3: p, 4: p });
    const formed = (p: { x: number; y: number }) => {
      const e = runBattle(content, "patrol", 1, { placements: all(p) }).log[0]!;
      if (e.kind !== "start") throw new Error("missing start");
      return e.units.filter((u) => u.side === "player");
    };
    const top = formed({ x: 1, y: 1 });
    const bottom = formed({ x: 1, y: 6 });
    const meanY = (us: { pos: { y: number } }[]) => us.reduce((a, u) => a + u.pos.y, 0) / us.length;
    expect(meanY(top)).toBeLessThan(meanY(bottom));
    // Melee in front (larger x, toward the enemy), ranged behind.
    const x = (us: typeof top, name: string) => us.find((u) => u.name === name)!.pos.x;
    expect(x(top, "Aldric")).toBeGreaterThan(x(top, "Wren"));
    expect(new Set(top.map((u) => `${u.pos.x},${u.pos.y}`)).size).toBe(top.length);
  });

  it("previews an opening turn order", () => {
    const { order, units } = previewTurnOrder(content, "duel", 6);
    expect(order).toHaveLength(6);
    // Vex is much faster, so goes first.
    expect(units[order[0]!]!.name).toBe("Vex");
  });

  it("formats a readable text log", () => {
    const lines = formatLog(runBattle(content, "duel", 1).log);
    expect(lines[0]).toContain("Battle 'duel'");
    expect(lines.at(-1)).toMatch(/wins|Draw/);
  });

  it("logs AI reasoning in debug mode", () => {
    const r = runBattle(content, "duel", 1, { debug: true });
    const d = r.log.find((e) => e.kind === "decide");
    expect(d && d.kind === "decide" && d.candidates.length).toBeGreaterThan(0);
  });
});
