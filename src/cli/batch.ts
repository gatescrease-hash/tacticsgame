/**
 * Headless batch runner: play one scenario across many seeds and report.
 *   npm run batch -- [scenario] [runs]
 * The seed for run i is i, so any interesting run can be replayed with
 * `npm run battle -- <scenario> <i>`.
 */
import { content, scenarioIds } from "../content/index.js";
import { runBattle } from "../sim/index.js";

const [scenario = "duel", runsArg = "1000"] = process.argv.slice(2);
if (!content.scenarios[scenario]) {
  console.error(`Unknown scenario '${scenario}'. Available: ${scenarioIds.join(", ")}`);
  process.exit(1);
}
const runs = Number(runsArg);

const wins = { player: 0, enemy: 0, draw: 0 };
let totalTicks = 0;
const damageBy = new Map<string, number>();
const t0 = performance.now();

for (let seed = 1; seed <= runs; seed++) {
  const r = runBattle(content, scenario, seed);
  wins[r.winner]++;
  totalTicks += r.ticks;
  for (const e of r.log) {
    if (e.kind !== "attack") continue;
    const name = r.units[e.uid]!.name;
    damageBy.set(name, (damageBy.get(name) ?? 0) + e.damage);
  }
}

const ms = performance.now() - t0;
const pct = (n: number) => `${((100 * n) / runs).toFixed(1)}%`;
console.log(`Scenario '${scenario}', ${runs} runs in ${ms.toFixed(0)} ms (${((runs / ms) * 1000).toFixed(0)} battles/s)`);
console.log(`  player wins ${pct(wins.player)}, enemy wins ${pct(wins.enemy)}, draws ${pct(wins.draw)}`);
console.log(`  mean length ${(totalTicks / runs).toFixed(0)} ticks`);
const totalDamage = [...damageBy.values()].reduce((a, b) => a + b, 0) || 1;
console.log("  damage share:");
for (const [name, d] of [...damageBy].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${name.padEnd(10)} ${((100 * d) / totalDamage).toFixed(1)}%`);
}
