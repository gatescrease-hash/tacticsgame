import type { BattleResult } from "../sim/index.js";

/** Aggregate batch results into a readable report. Shared by the CLI and tests. */
export interface BatchStats {
  runs: number;
  wins: { player: number; enemy: number; draw: number };
  meanTicks: number;
  damageByUnit: Map<string, number>;
  abilityUse: Map<string, number>;
  knockouts: Map<string, number>;
}

export function aggregate(results: BattleResult[]): BatchStats {
  const stats: BatchStats = {
    runs: results.length,
    wins: { player: 0, enemy: 0, draw: 0 },
    meanTicks: 0,
    damageByUnit: new Map(),
    abilityUse: new Map(),
    knockouts: new Map(),
  };
  let ticks = 0;
  const bump = (m: Map<string, number>, k: string, v = 1) => m.set(k, (m.get(k) ?? 0) + v);
  for (const r of results) {
    stats.wins[r.winner]++;
    ticks += r.ticks;
    for (const e of r.log) {
      if (e.kind === "hit") bump(stats.damageByUnit, r.units[e.uid]!.name, e.damage);
      else if (e.kind === "dot") {
        // DoT damage goes to whoever applied it? Unknown here; attribute to the status.
        bump(stats.damageByUnit, `(${e.status})`, e.damage);
      } else if (e.kind === "ability") bump(stats.abilityUse, `${r.units[e.uid]!.name}: ${e.counter ? "counter" : e.abilityName}`);
      else if (e.kind === "knockout") bump(stats.knockouts, r.units[e.uid]!.name);
    }
  }
  stats.meanTicks = results.length ? Math.round(ticks / results.length) : 0;
  return stats;
}

export function summarize(id: string, results: BattleResult[], ms: number, tempo?: { flips: number; jitter: number }): string {
  const s = aggregate(results);
  const pct = (n: number) => `${((100 * n) / s.runs).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`== ${id}: ${s.runs} runs in ${ms.toFixed(0)} ms (${((s.runs / ms) * 1000).toFixed(0)} battles/s)`);
  lines.push(`  wins: player ${pct(s.wins.player)}, enemy ${pct(s.wins.enemy)}, draw ${pct(s.wins.draw)}   mean length ${s.meanTicks} ticks`);
  if (tempo) lines.push(`  tempo sensitivity: winner flips in ${pct(tempo.flips)} of seeds with opening gauges jittered by up to ${tempo.jitter}`);
  const total = [...s.damageByUnit.values()].reduce((a, b) => a + b, 0) || 1;
  lines.push("  damage share:");
  for (const [name, d] of [...s.damageByUnit].sort((a, b) => b[1] - a[1])) {
    lines.push(`    ${name.padEnd(18)} ${((100 * d) / total).toFixed(1).padStart(5)}%   KO'd in ${pct(s.knockouts.get(name) ?? 0)}`);
  }
  lines.push("  ability use (per battle):");
  for (const [k, n] of [...s.abilityUse].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    lines.push(`    ${k.padEnd(34)} ${(n / s.runs).toFixed(1)}`);
  }
  return lines.join("\n");
}
