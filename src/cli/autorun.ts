/**
 * Headless auto-player for the run loop: plays whole runs with a simple policy
 * and reports how long they last.
 *   npm run autorun -- [--runs 20] [--policy sensible|careless] [--ramp 4]
 *                      [--difficulty normal] [--samples 12] [--from 1] [--verbose]
 *
 * sensible: deploys its highest-level units; rests when low on hearts, recruits
 *           until it has 6 units, then prefers training.
 * careless: deploys a random selection and takes a random reward.
 */
import { content } from "../content/index.js";
import { Rng, type Difficulty } from "../sim/index.js";
import { applyResult, battlesWon, chooseOffer, currentEncounter, defaultDeployment, fight, newRun, type Offer, type RunState } from "../run/run.js";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : dflt;
};
const runs = Number(flag("runs", "20"));
const from = Number(flag("from", "1"));
const policy = flag("policy", "sensible");
const verbose = args.includes("--verbose");
const config = {
  ramp: Number(flag("ramp", "5")),
  difficulty: flag("difficulty", "normal") as Difficulty,
  samples: Number(flag("samples", "12")),
};
const MAX_BATTLES = 60;

function pickOffer(run: RunState, offers: Offer[], rng: Rng): number {
  if (policy === "careless") return rng.int(offers.length);
  const rank = (o: Offer) =>
    o.kind === "rest" && run.hearts <= 2 ? 0 : o.kind === "recruit" && run.roster.length < 6 ? 1 : o.kind === "train" ? 2 : o.kind === "trinket" ? 3 : 4;
  let best = 0;
  for (let i = 1; i < offers.length; i++) if (rank(offers[i]!) < rank(offers[best]!)) best = i;
  return best;
}

function deploy(run: RunState, slots: number, rng: Rng): string[] {
  if (policy !== "careless") return defaultDeployment(run, slots);
  const pool = run.roster.map((r) => r.unitId);
  const n = Math.min(slots, pool.length);
  const out: string[] = [];
  while (out.length < n) out.push(pool.splice(rng.int(pool.length), 1)[0]!);
  return out;
}

const lengths: number[] = [];
let battles = 0;
let wins = 0;
const t0 = performance.now();
for (let seed = from; seed < from + runs; seed++) {
  const run = newRun(seed, config);
  const rng = new Rng(seed * 7 + 1);
  while (!run.over && run.battle < MAX_BATTLES) {
    const enc = currentEncounter(content, run);
    const { record } = fight(content, run, deploy(run, enc.slots, rng));
    applyResult(content, run, record);
    battles++;
    if (record.won) wins++;
    if (verbose) {
      console.log(
        `  run ${seed} #${record.battle + 1} ${record.scenario.padEnd(8)} +${record.enemyPower}%  p=${record.winProb}%  ${record.won ? "WIN " : `LOSS -${record.heartsLost}`}  hearts ${run.hearts}  roster ${run.roster.map((r) => `${r.unitId}${r.level}`).join(",")}`,
      );
    }
    if (run.offers) chooseOffer(run, pickOffer(run, run.offers, rng));
  }
  lengths.push(run.history.length);
  if (verbose) console.log(`run ${seed}: ${run.history.length} battles, ${battlesWon(run)} won`);
}
lengths.sort((a, b) => a - b);
const q = (f: number) => lengths[Math.floor(f * (lengths.length - 1))]!;
console.log(
  `policy ${policy}, ramp ${config.ramp}%/battle, ${config.difficulty}, ${runs} runs: battles per run median ${q(0.5)} [10th ${q(0.1)} - 90th ${q(0.9)}], ` +
    `battle win ${((100 * wins) / battles).toFixed(0)}%  (${((performance.now() - t0) / 1000).toFixed(0)}s)`,
);
