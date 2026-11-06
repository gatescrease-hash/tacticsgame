/**
 * Pacing report: how battles feel to watch. Per scenario, over seeds 1..runs:
 *   npm run pacing -- [scenario|all] [runs] [--rules '{"nerve":60}']
 * first   ticks until the first damage lands
 * len     battle length in ticks
 * turns   how turns are spent: act (ability), adv (step that closes on the nearest enemy),
 *         back (step away from it), side (neither), wait; flip = steps straight back to the tile just left
 * hit%    average damage per landed hit, % of the target's max HP
 * acts    abilities used per unit per 100 ticks
 */
import { content, scenarioIds } from "../content/index.js";
import { runBattle } from "../sim/index.js";
import { addPacing, emptyPacing, pacingOf, type Pacing } from "../tools/pacing.js";

const argv = process.argv.slice(2);
const ri = argv.indexOf("--rules");
const rules = ri >= 0 ? JSON.parse(argv[ri + 1]!) : {};
const args = argv.filter((a, i) => !a.startsWith("--") && !(ri >= 0 && i === ri + 1));
const [which = "all", runsArg = "40"] = args;
const runs = Number(runsArg);
const ids = which === "all" ? scenarioIds : [which];

function line(name: string, p: Pacing, n: number, pwin?: number): string {
  const turns = p.act + p.toward + p.away + p.side + p.wait;
  const pc = (x: number) => `${((100 * x) / turns).toFixed(0)}%`.padStart(4);
  return (
    `${name.padEnd(9)} first ${(p.first / n).toFixed(0).padStart(4)}  len ${(p.length / n).toFixed(0).padStart(4)}  ` +
    `act ${pc(p.act)} adv ${pc(p.toward)} back ${pc(p.away)} side ${pc(p.side)} wait ${pc(p.wait)} flip ${pc(p.flip)}  ` +
    `hit% ${(p.hitPct / Math.max(1, p.hits)).toFixed(1).padStart(4)}  acts/100t ${((100 * p.act) / p.unitTicks).toFixed(2)}` +
    (pwin === undefined ? "" : `  pwin ${pwin.toFixed(0)}%`)
  );
}

let total = emptyPacing();
let n = 0;
for (const id of ids) {
  let p = emptyPacing();
  let wins = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const res = runBattle(content, id, seed, { rules });
    p = addPacing(p, pacingOf(res.log));
    if (res.winner === "player") wins++;
  }
  console.log(line(id, p, runs, (100 * wins) / runs));
  total = addPacing(total, p);
  n += runs;
}
if (ids.length > 1) console.log(line("ALL", total, n));
