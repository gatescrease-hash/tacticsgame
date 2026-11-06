/**
 * Pacing report: how battles feel to watch. Per scenario, over seeds 1..runs:
 *   npm run pacing -- [scenario|all] [runs]
 * first   ticks until the first damage lands
 * len     battle length in ticks
 * turns   how turns are spent: act (ability), adv (step that closes on the nearest enemy),
 *         back (step away from it), side (neither), wait; flip = steps straight back to the tile just left
 * hit%    average damage per landed hit, % of the target's max HP
 * acts    abilities used per unit per 100 ticks
 */
import { content, scenarioIds } from "../content/index.js";
import { runBattle } from "../sim/index.js";

const argv = process.argv.slice(2);
const ri = argv.indexOf("--rules");
const rules = ri >= 0 ? JSON.parse(argv[ri + 1]!) : {};
const args = argv.filter((a, i) => !a.startsWith("--") && !(ri >= 0 && i === ri + 1));
const [which = "all", runsArg = "40"] = args;
const runs = Number(runsArg);
const ids = which === "all" ? scenarioIds : [which];

const md = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const tot = { first: 0, len: 0, act: 0, adv: 0, back: 0, side: 0, wait: 0, hitPct: 0, hits: 0, acts: 0, unitTicks: 0, n: 0, pw: 0, flip: 0 };
for (const id of ids) {
  const r = { first: 0, len: 0, act: 0, adv: 0, back: 0, side: 0, wait: 0, hitPct: 0, hits: 0, acts: 0, unitTicks: 0, n: 0, pw: 0, flip: 0 };
  for (let seed = 1; seed <= runs; seed++) {
    const res = runBattle(content, id, seed, { rules });
    const start = res.log[0]!;
    if (start.kind !== "start") continue;
    const pos = new Map(start.units.map((u) => [u.uid, { ...u.pos }]));
    const lastFrom = new Map<number, string>();
    const side = new Map(start.units.map((u) => [u.uid, u.side]));
    const maxHp = new Map(start.units.map((u) => [u.uid, u.maxHp]));
    const alive = new Set(start.units.map((u) => u.uid));
    let first = -1;
    let end = 0;
    for (const e of res.log) {
      end = e.t;
      if (e.kind === "move") {
        const foes = [...alive].filter((o) => side.get(o) !== side.get(e.uid));
        const near = (p: { x: number; y: number }) => Math.min(...foes.map((o) => md(p, pos.get(o)!)));
        const d0 = near(e.from), d1 = near(e.to);
        if (d1 < d0) r.adv++; else if (d1 > d0) r.back++; else r.side++;
        if (lastFrom.get(e.uid) === `${e.to.x},${e.to.y}`) r.flip++;
        lastFrom.set(e.uid, `${e.from.x},${e.from.y}`);
        pos.set(e.uid, { ...e.to });
      } else if (e.kind === "push") pos.set(e.uid, { ...e.to });
      else if (e.kind === "ability" && !e.counter) { r.act++; r.acts++; }
      else if (e.kind === "wait") r.wait++;
      else if (e.kind === "hit" && e.damage > 0) {
        if (first < 0) first = e.t;
        r.hitPct += (100 * e.damage) / maxHp.get(e.target)!;
        r.hits++;
      } else if (e.kind === "knockout") alive.delete(e.uid);
    }
    r.first += first < 0 ? end : first;
    r.len += end;
    r.unitTicks += start.units.length * end;
    r.n++;
    if (res.winner === "player") r.pw++;
  }
  const turns = r.act + r.adv + r.back + r.side + r.wait;
  const pc = (x: number) => `${((100 * x) / turns).toFixed(0)}%`.padStart(4);
  console.log(
    `${id.padEnd(9)} first ${(r.first / r.n).toFixed(0).padStart(4)}  len ${(r.len / r.n).toFixed(0).padStart(4)}  ` +
      `act ${pc(r.act)} adv ${pc(r.adv)} back ${pc(r.back)} side ${pc(r.side)} wait ${pc(r.wait)} flip ${pc(r.flip)}  ` +
      `hit% ${(r.hitPct / Math.max(1, r.hits)).toFixed(1).padStart(4)}  acts/100t ${((100 * r.acts) / r.unitTicks).toFixed(2)}  pwin ${((100 * r.pw) / r.n).toFixed(0)}%`,
  );
  for (const k of Object.keys(tot) as (keyof typeof tot)[]) tot[k] += r[k];
}
if (ids.length > 1) {
  const turns = tot.act + tot.adv + tot.back + tot.side + tot.wait;
  const pc = (x: number) => `${((100 * x) / turns).toFixed(0)}%`.padStart(4);
  console.log(
    `${"ALL".padEnd(9)} first ${(tot.first / tot.n).toFixed(0).padStart(4)}  len ${(tot.len / tot.n).toFixed(0).padStart(4)}  ` +
      `act ${pc(tot.act)} adv ${pc(tot.adv)} back ${pc(tot.back)} side ${pc(tot.side)} wait ${pc(tot.wait)} flip ${pc(tot.flip)}  ` +
      `hit% ${(tot.hitPct / Math.max(1, tot.hits)).toFixed(1).padStart(4)}  acts/100t ${((100 * tot.acts) / tot.unitTicks).toFixed(2)}`,
  );
}
