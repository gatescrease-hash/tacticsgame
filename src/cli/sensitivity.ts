/**
 * Sensitivity report: how much do small nudges swing outcomes?
 *   npm run sensitivity -- [--runs 60] [--presets a,b] [--scenarios a,b] [--detail]
 *
 * For each rules preset and scenario it measures:
 *  - win%    base player win rate.
 *  - flip    % of seeds whose winner changes when opening gauges are jittered by
 *            up to 20, and that as a ratio of 2p(1-p), which is the flip rate two
 *            *independent* battles would show. Ratio ~1 = the nudge effectively
 *            re-rolls the whole battle; lower is better.
 *  - tempo   win% with the player side given +30 opening gauge, minus win% at -30.
 *            How much a head start is worth. Lower = less tempo-sensitive.
 *  - curve   win% as enemy HP and damage step through -20%..+40% in 10% steps.
 *            jump = largest change between neighbouring steps (cliffs), mono =
 *            number of steps where a stronger enemy did *better* for the player.
 */
import { content } from "../content/index.js";
import { BASELINE_RULES, runBattle, type BattleOptions, type Rules } from "../sim/index.js";

export const PRESETS: Record<string, Partial<Rules>> = {
  baseline: BASELINE_RULES,
  /** The current defaults, and the defaults before the pacing change (bigger, rarer actions; no nerve/advance). */
  default: {},
  "old-pacing": { hpScale: 150, actionScale: 100, nerve: 100, advance: 0 },
  streams: { unitStreams: true },
  "streams+hp150": { unitStreams: true, hpScale: 150 },
  "streams+spread": { unitStreams: true, damageSpread: 20 },
  "streams+charge": { unitStreams: true, charge: true },
  "streams+underdog": { unitStreams: true, underdog: 10 },
  all: { unitStreams: true, hpScale: 150, damageSpread: 20, charge: true, underdog: 10 },
  // Ablations: everything except one rule.
  "all-streams": { unitStreams: false, hpScale: 150, damageSpread: 20, charge: true, underdog: 10 },
  "all-hp": { unitStreams: true, hpScale: 100, damageSpread: 20, charge: true, underdog: 10 },
  "all-spread": { unitStreams: true, hpScale: 150, damageSpread: 0, charge: true, underdog: 10 },
  "all-charge": { unitStreams: true, hpScale: 150, damageSpread: 20, charge: false, underdog: 10 },
  "all-underdog": { unitStreams: true, hpScale: 150, damageSpread: 20, charge: true, underdog: 0 },
};

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : dflt;
};
const runs = Number(flag("runs", "60"));
const presets = flag("presets", Object.keys(PRESETS).join(",")).split(",");
const scenarios = flag("scenarios", "skirmish,patrol,foundry,marsh,wolves").split(",");
const detail = args.includes("--detail");
const LEVELS = [-20, -10, 0, 10, 20, 30, 40];

function winRate(id: string, opts: BattleOptions): { win: number; winners: string[]; ticks: number } {
  let wins = 0;
  let ticks = 0;
  const winners: string[] = [];
  for (let seed = 1; seed <= runs; seed++) {
    const r = runBattle(content, id, seed, opts);
    if (r.winner === "player") wins++;
    ticks += r.ticks;
    winners.push(r.winner);
  }
  return { win: (100 * wins) / runs, winners, ticks: ticks / runs };
}

const pad = (v: string | number, n: number) => String(v).padStart(n);
console.log(`runs per point: ${runs}`);
console.log(`${"preset".padEnd(18)}${pad("win%", 6)}${pad("flip%", 7)}${pad("ratio", 7)}${pad("tempo", 7)}${pad("jump", 6)}${pad("mono", 6)}${pad("ticks", 7)}${pad("b/s", 6)}`);

for (const name of presets) {
  const rules = PRESETS[name];
  if (!rules) throw new Error(`unknown preset ${name}`);
  const t0 = performance.now();
  let battles = 0;
  const agg = { win: 0, flip: 0, ratio: 0, tempo: 0, jump: 0, mono: 0, ticks: 0 };
  for (const id of scenarios) {
    const base = winRate(id, { rules });
    const jit = winRate(id, { rules, gaugeJitter: 20 });
    const flips = base.winners.filter((w, i) => w !== jit.winners[i]).length;
    const flip = (100 * flips) / runs;
    const p = base.win / 100;
    const indep = 100 * 2 * p * (1 - p);
    const ratio = indep > 0 ? flip / indep : 0;
    const tempo = winRate(id, { rules, tempoOffset: 30 }).win - winRate(id, { rules, tempoOffset: -30 }).win;
    const curve = LEVELS.map((lvl) => (lvl === 0 ? base.win : winRate(id, { rules, enemyPower: lvl }).win));
    let jump = 0;
    let mono = 0;
    for (let i = 1; i < curve.length; i++) {
      jump = Math.max(jump, Math.abs(curve[i]! - curve[i - 1]!));
      if (curve[i]! > curve[i - 1]! + 0.01) mono++;
    }
    battles += runs * (2 + 2 + LEVELS.length - 1);
    agg.win += base.win;
    agg.flip += flip;
    agg.ratio += ratio;
    agg.tempo += tempo;
    agg.jump += jump;
    agg.mono += mono;
    agg.ticks += base.ticks;
    if (detail) {
      console.log(
        `  ${id.padEnd(16)}${pad(base.win.toFixed(0), 6)}${pad(flip.toFixed(0), 7)}${pad(ratio.toFixed(2), 7)}${pad(tempo.toFixed(0), 7)}${pad(jump.toFixed(0), 6)}${pad(mono, 6)}${pad(base.ticks.toFixed(0), 7)}   curve ${curve.map((c) => c.toFixed(0)).join(" ")}`,
      );
    }
  }
  const n = scenarios.length;
  const bps = (battles / (performance.now() - t0)) * 1000;
  console.log(
    `${name.padEnd(18)}${pad((agg.win / n).toFixed(0), 6)}${pad((agg.flip / n).toFixed(0), 7)}${pad((agg.ratio / n).toFixed(2), 7)}${pad((agg.tempo / n).toFixed(0), 7)}${pad((agg.jump / n).toFixed(0), 6)}${pad(agg.mono, 6)}${pad((agg.ticks / n).toFixed(0), 7)}${pad(bps.toFixed(0), 6)}`,
  );
}
