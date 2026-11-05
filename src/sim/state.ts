import type { Grid } from "./grid.js";
import type { BattleEvent, BattleLog } from "./log.js";
import type { Rng } from "./rng.js";
import type { Content, Pos, ScenarioDef, Side, Unit } from "./types.js";

/**
 * Global combat rules. These are the knobs tested by `npm run sensitivity`
 * against tempo sensitivity and difficulty cliffs; see README "Sensitivity".
 */
export interface Rules {
  /**
   * Each unit rolls from its own random stream instead of one shared stream.
   * A change in one unit's timing then doesn't reshuffle everyone else's luck.
   */
  unitStreams: boolean;
  /** Percent multiplier on every unit's max HP. Longer fights average out swings. */
  hpScale: number;
  /** Damage varies by up to ±this percent per hit, blurring hits-to-kill breakpoints. */
  damageSpread: number;
  /** A unit that steps into range from out of range may strike in the same turn (gauge debt). */
  charge: boolean;
  /** Outnumbered units take this percent less damage per unit of deficit (max 3 steps). */
  underdog: number;
  /**
   * Fire Emblem-style "true hit": stage rolls average two d100s, so high chances
   * land more often than shown and low chances less (75% -> ~88%, 25% -> ~12%).
   * Crits stay a single roll.
   */
  trueHit: boolean;
  /**
   * The player's squad arranges itself by role at battle start, centred on where
   * the player put it: melee in front, support in the middle, ranged behind.
   * Coarse placement (which ground) matters; exact tiles don't.
   */
  formation: boolean;
  /**
   * The player's squad holds its ground until an enemy comes within this many
   * tiles (or someone is hurt), letting the enemy walk in. 0 = off. Ignored
   * when the enemy doctrine is itself an ambush (hold).
   */
  playerHold: number;
}

export const BASELINE_RULES: Rules = {
  unitStreams: false, hpScale: 100, damageSpread: 0, charge: false, underdog: 0, trueHit: false, formation: false, playerHold: 0,
};

/**
 * The rules battles use unless told otherwise. Chosen with `npm run sensitivity`:
 * together these cut the value of a +/-30 opening head start from ~37 to ~7 win-%
 * points and made every difficulty curve monotonic (see README "Sensitivity").
 */
export const DEFAULT_RULES: Rules = {
  unitStreams: true, hpScale: 150, damageSpread: 20, charge: true, underdog: 10, trueHit: false, formation: false, playerHold: 0,
};

export interface BattleOptions {
  /** Safety valve: declare a draw after this many ticks. */
  maxTicks?: number;
  /** Log the AI's candidate scores ("decide" events). */
  debug?: boolean;
  /** Log projected turn order at each turn (for the playback turn bar). */
  recordQueue?: boolean;
  /** Perturb opening gauges by up to this much (tempo-sensitivity testing). */
  gaugeJitter?: number;
  /** Added to every player unit's opening gauge (tempo-advantage testing; may be negative). */
  tempoOffset?: number;
  /** Percent added to enemy HP and damage dealt (difficulty-curve testing; may be negative). */
  enemyPower?: number;
  /** Override starting positions, keyed by scenario unit index. */
  placements?: Record<number, Pos>;
  /** Leave these scenario unit indexes out of the battle (benched). */
  benched?: number[];
  /** Override combat rules (merged over DEFAULT_RULES). */
  rules?: Partial<Rules>;
}

export interface BattleState {
  content: Content;
  scenario: ScenarioDef;
  seed: number;
  grid: Grid;
  units: Unit[];
  /** Shared random stream (used for everything when rules.unitStreams is off). */
  rng: Rng;
  /** Per-unit random streams, indexed by uid (rules.unitStreams). */
  streams: Rng[];
  rules: Rules;
  /** Current tick. */
  t: number;
  log: BattleLog;
  opts: BattleOptions;
}

export function emit(s: BattleState, e: BattleEvent): void {
  s.log.push(e);
}

/** The random stream a unit's own rolls come from. */
export function rngFor(s: BattleState, u: Unit): Rng {
  return s.rules.unitStreams ? s.streams[u.uid]! : s.rng;
}

export function living(s: BattleState, side?: Side): Unit[] {
  return s.units.filter((u) => u.alive && (side === undefined || u.side === side));
}

export function enemiesOf(s: BattleState, u: Unit): Unit[] {
  return s.units.filter((v) => v.alive && v.side !== u.side);
}

export function alliesOf(s: BattleState, u: Unit): Unit[] {
  return s.units.filter((v) => v.alive && v.side === u.side);
}

export function unitAt(s: BattleState, p: Pos): Unit | undefined {
  return s.units.find((u) => u.alive && u.pos.x === p.x && u.pos.y === p.y);
}
