import type { Grid } from "./grid.js";
import type { BattleEvent, BattleLog } from "./log.js";
import type { Rng } from "./rng.js";
import type { Content, Modifier, Pos, ScenarioDef, Side, Unit } from "./types.js";

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
   * How chance rolls work.
   *  - "dice": each stage roll averages `hitDice` d100s. 1 = honest odds; 2 =
   *    Fire Emblem "true hit" (75% shown lands ~88%, 25% ~12%); more = more decisive.
   *  - "meter": bounded luck. Each unit keeps a meter per stage; an attempt adds
   *    the chance and succeeds once the meter passes 100. Long-run rates are exact
   *    and streaks can't happen; the seed only sets where each meter starts.
   * Crits always use one die (or their own meter).
   */
  luck: "dice" | "meter";
  hitDice: number;
  /** With luck "meter": false starts every meter at 50, so the seed changes nothing. */
  seededLuck: boolean;
  /** Which side acts first when two units are exactly tied on initiative. */
  ties: Side;
  /** The player's squad picks one shared target and concentrates on it. */
  focusFire: boolean;
  /** AI commitment: units prefer their current target (x1.5) and switch only for a clearly better one. */
  commitTarget: boolean;
  /**
   * AI commitment: a unit that sets off toward a goal keeps walking that path for up to
   * this many steps without re-deciding, unless hurt, an enemy comes in range, or the
   * way is blocked. 0 = re-decide every step.
   */
  stride: number;
  /** Before contact, penalty per tile for stepping more than 2 tiles from the nearest ally. 0 = off. */
  cohesion: number;
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
  /**
   * Percent scale on ability gauge costs and cooldowns (and per-action buildup and
   * gauge effects), paired with hpScale: lower = more, smaller actions at the same
   * damage per tick. 100 = the original pacing.
   */
  actionScale: number;
  /**
   * Nerve: healthy units shrug off danger and wounded ones grow careful. At full HP
   * caution is scaled to this percent, rising to 100% at half HP. 100 = off.
   */
  nerve: number;
  /** Until it has something in reach, each step toward the nearest enemy is worth this much (and each step away costs it). 0 = off. */
  advance: number;
}

export const BASELINE_RULES: Rules = {
  unitStreams: false, hpScale: 100, damageSpread: 0, charge: false, underdog: 0, luck: "dice", hitDice: 1, seededLuck: true, ties: "player", focusFire: false, commitTarget: false, stride: 0, cohesion: 0, formation: false, playerHold: 0, actionScale: 100, nerve: 100, advance: 0,
};

/**
 * The rules battles use unless told otherwise. Chosen with `npm run sensitivity`:
 * together these cut the value of a +/-30 opening head start from ~37 to ~7 win-%
 * points and made every difficulty curve monotonic (see README "Sensitivity").
 * Pacing (actionScale 60 with hpScale 250, nerve, advance) was chosen with `npm run pacing`:
 * more, smaller actions and units that press forward instead of hovering at the edge of reach.
 */
export const DEFAULT_RULES: Rules = {
  unitStreams: true, hpScale: 250, damageSpread: 20, charge: true, underdog: 10, luck: "meter", hitDice: 1, seededLuck: true, ties: "player", focusFire: false, commitTarget: false, stride: 0, cohesion: 0, formation: true, playerHold: 0, actionScale: 60, nerve: 40, advance: 6,
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
  /**
   * A run's roster: replaces the scenario's player units. Each entry is a unit id
   * plus run-persistent extras (progression mods, trinkets). They start at `anchor`
   * (default: the scenario's first player tile) and form up from there.
   */
  roster?: { unitId: string; mods?: Modifier[]; trinkets?: string[] }[];
  anchor?: Pos;
  /**
   * Shift the player's squad (anchor, or all placements) by this many tiles before it
   * forms up, clamped to the deploy zone. Used by settling to sample nearby spots.
   */
  anchorShift?: Pos;
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
