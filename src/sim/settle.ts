import { runBattle, type BattleResult } from "./battle.js";
import type { BattleOptions } from "./state.js";
import { maxHp } from "./stats.js";
import type { Content, Side } from "./types.js";

/**
 * Settled outcomes ("the result is decided, the details flex").
 *
 * A setup is simulated across a fixed set of sample seeds to estimate the
 * player's win probability. The difficulty turns that probability into a
 * settled result, and the battle the player watches is one of the samples that
 * produced it: a real, unaltered simulation, chosen rather than fiddled.
 *
 * Because the sample seeds are fixed, the result depends only on the setup
 * (roster, placement, scenario), never on luck. A coin-flip setup can't flip
 * against you between attempts; only changing the setup changes the result.
 */

export type Difficulty = "easy" | "normal" | "hard";

export interface DifficultyDef {
  /** Minimum player win probability (percent) for the player to win. */
  threshold: number;
  /** Which battle to show among those with the settled result: margin percentile (0 = closest, 100 = most lopsided). */
  marginPercentile: number;
}

/**
 * Thresholds were set from `npm run robustness -- --settle`: at exact parity
 * (mirror matches) the player's raw win probability is ~35-45%, because the
 * player's side tends to step into range first. Normal therefore sits at 35 so
 * that even fights go to the player, while a clearly stronger enemy (+15-30%
 * power, p ~10-30%) still wins.
 */
export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  // You win unless clearly outmatched, and wins look comfortable.
  easy: { threshold: 15, marginPercentile: 75 },
  // Even fights go to you; a clearly stronger enemy beats you. Typical-looking battles.
  normal: { threshold: 35, marginPercentile: 50 },
  // You need the stronger setup, and wins are scrappy.
  hard: { threshold: 55, marginPercentile: 25 },
};

export interface SettleOptions {
  difficulty?: Difficulty;
  /** Number of sample battles (default 24). */
  samples?: number;
  /**
   * Spread samples over the chosen spot and its neighbours (default true), so the
   * settled result reflects "roughly here with this roster" and a one-tile shift
   * can't flip it. The battle shown is preferably one formed up exactly where chosen.
   */
  smoothPlacement?: boolean;
  /** Override the difficulty's threshold (min player win %) and shown-battle margin percentile. */
  threshold?: number;
  marginPercentile?: number;
}

/** Squad shifts cycled through by the samples: the chosen spot first, then its 8 neighbours. */
const SHIFTS = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
];

export interface SettleResult {
  /** The battle to show (re-run with the caller's options, e.g. recordQueue). */
  result: BattleResult;
  /** Player win probability across the samples, percent. */
  winProb: number;
  samples: number;
  settled: Side | "draw";
  /** The sample seed that was shown. */
  seed: number;
  /** Winner's remaining HP as a percent of its starting HP (0 for draws). */
  margin: number;
}

/** First sample seed; samples are SAMPLE_BASE + 0..n-1, independent of the user's seed. */
const SAMPLE_BASE = 10_001;

/** How decisively a battle was won: the winner's surviving HP as a percent of its total. */
export function winMargin(r: BattleResult): number {
  if (r.winner === "draw") return 0;
  let hp = 0;
  let max = 0;
  for (const u of r.units) {
    if (u.side !== r.winner) continue;
    hp += u.alive ? u.hp : 0;
    max += maxHp(u);
  }
  return max > 0 ? Math.round((100 * hp) / max) : 0;
}

export interface Sample {
  seed: number;
  winner: Side | "draw";
  margin: number;
  /** Squad shift this sample used (smoothPlacement). */
  shift: { x: number; y: number };
}

/** Simulate a setup across the fixed sample seeds. */
export function sampleSetup(content: Content, scenarioId: string, opts: BattleOptions = {}, n = 24, smooth = false): Sample[] {
  const samples: Sample[] = [];
  for (let i = 0; i < n; i++) {
    const seed = SAMPLE_BASE + i;
    const shift = smooth ? SHIFTS[i % SHIFTS.length]! : SHIFTS[0]!;
    // Samples don't need the playback extras.
    const r = runBattle(content, scenarioId, seed, { ...opts, recordQueue: false, debug: false, anchorShift: shift });
    samples.push({ seed, winner: r.winner, margin: winMargin(r), shift });
  }
  return samples;
}

export function settleBattle(
  content: Content,
  scenarioId: string,
  seed: number,
  opts: BattleOptions = {},
  settle: SettleOptions = {},
): SettleResult {
  const diff = { ...DIFFICULTIES[settle.difficulty ?? "normal"] };
  if (settle.threshold !== undefined) diff.threshold = settle.threshold;
  if (settle.marginPercentile !== undefined) diff.marginPercentile = settle.marginPercentile;
  const n = Math.max(1, settle.samples ?? 24);
  const samples = sampleSetup(content, scenarioId, opts, n, settle.smoothPlacement ?? true);
  const wins = samples.filter((x) => x.winner === "player").length;
  const winProb = Math.round((100 * wins) / n);
  const settled: Side = winProb >= diff.threshold ? "player" : "enemy";

  // Battles with the settled result, closest first. (A loss may include draws if no clean loss exists.)
  let matching = samples.filter((x) => x.winner === settled);
  if (matching.length === 0) matching = samples.filter((x) => x.winner !== "player");
  if (matching.length === 0) matching = samples;
  // Prefer battles formed up exactly where the player chose.
  const exact = matching.filter((x) => x.shift.x === 0 && x.shift.y === 0);
  if (exact.length > 0) matching = exact;
  matching.sort((a, b) => a.margin - b.margin || a.seed - b.seed);

  // Pick around the difficulty's margin percentile; the user's seed varies which nearby battle is shown.
  const target = Math.round(((matching.length - 1) * diff.marginPercentile) / 100);
  const jitter = (((seed % 3) + 3) % 3) - 1;
  const idx = Math.min(matching.length - 1, Math.max(0, target + jitter));
  const chosen = matching[idx]!;

  const result = runBattle(content, scenarioId, chosen.seed, { ...opts, anchorShift: chosen.shift });
  return { result, winProb, samples: n, settled: result.winner, seed: chosen.seed, margin: chosen.margin };
}
