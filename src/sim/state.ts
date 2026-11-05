import type { Grid } from "./grid.js";
import type { BattleEvent, BattleLog } from "./log.js";
import type { Rng } from "./rng.js";
import type { Content, Pos, ScenarioDef, Side, Unit } from "./types.js";

export interface BattleOptions {
  /** Safety valve: declare a draw after this many ticks. */
  maxTicks?: number;
  /** Log the AI's candidate scores ("decide" events). */
  debug?: boolean;
  /** Log projected turn order at each turn (for the playback turn bar). */
  recordQueue?: boolean;
  /** Perturb opening gauges by up to this much (tempo-sensitivity testing). */
  gaugeJitter?: number;
  /** Override starting positions, keyed by scenario unit index. */
  placements?: Record<number, Pos>;
  /** Leave these scenario unit indexes out of the battle (benched). */
  benched?: number[];
}

export interface BattleState {
  content: Content;
  scenario: ScenarioDef;
  seed: number;
  grid: Grid;
  units: Unit[];
  rng: Rng;
  /** Current tick. */
  t: number;
  log: BattleLog;
  opts: BattleOptions;
}

export function emit(s: BattleState, e: BattleEvent): void {
  s.log.push(e);
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
