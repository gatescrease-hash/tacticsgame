import type { BattleState } from "./state.js";
import { isFrozen, nextStatusTime } from "./statuses.js";
import { stat } from "./stats.js";
import type { Side, Unit } from "./types.js";

/**
 * Individual initiative timeline (FFT-style). Every tick, each unit's gauge
 * fills by its fill rate; at THRESHOLD it acts, and the action's cost is
 * subtracted (overflow kept). Cheap actions mean the next turn comes sooner.
 */

export const THRESHOLD = 100;

export function fillRate(u: Unit): number {
  return isFrozen(u) ? 0 : stat(u, "fillRate");
}

/** Opening initiative: seeded by speed so fast units still tend to go first. */
export function openingGauge(u: Unit): number {
  return Math.min(THRESHOLD - 1, stat(u, "fillRate") * 3);
}

/** Ticks until the next thing happens: a unit becomes ready or a status pulses/expires. */
export function ticksToNextEvent(s: BattleState): number {
  let best = nextStatusTime(s) - s.t;
  for (const u of s.units) {
    if (!u.alive) continue;
    const rate = fillRate(u);
    if (rate <= 0) continue;
    const need = THRESHOLD - u.gauge;
    best = Math.min(best, need <= 0 ? 0 : Math.ceil(need / rate));
  }
  return Math.max(1, best);
}

export function advance(s: BattleState, ticks: number): void {
  for (const u of s.units) if (u.alive) u.gauge += fillRate(u) * ticks;
  s.t += ticks;
}

/**
 * The ready unit that acts next. Ties: higher gauge, then fill rate, then
 * the `first` side (rules.ties), then uid. No randomness, so the same setup replays the same way.
 */
export function nextActor(units: Unit[], first: Side = "player"): Unit | null {
  let best: Unit | null = null;
  for (const u of units) {
    if (!u.alive || u.gauge < THRESHOLD || isFrozen(u)) continue;
    if (!best || compare(u, best, first) < 0) best = u;
  }
  return best;
}

function compare(a: Unit, b: Unit, first: Side): number {
  if (a.gauge !== b.gauge) return b.gauge - a.gauge;
  const ra = fillRate(a);
  const rb = fillRate(b);
  if (ra !== rb) return rb - ra;
  if (a.side !== b.side) return a.side === first ? -1 : 1;
  return a.uid - b.uid;
}

/**
 * Projected order of the next `n` turns, assuming each action costs a flat
 * THRESHOLD. Used for the turn-order bar and the setup-screen preview.
 */
export function projectTurnOrder(units: Unit[], n: number, first: Side = "player"): number[] {
  const sim = units
    .filter((u) => u.alive)
    .map((u) => ({ uid: u.uid, gauge: u.gauge, rate: fillRate(u), side: u.side }))
    .filter((x) => x.rate > 0);
  const out: number[] = [];
  if (sim.length === 0) return out;
  while (out.length < n) {
    let dt = Infinity;
    for (const x of sim) dt = Math.min(dt, x.gauge >= THRESHOLD ? 0 : Math.ceil((THRESHOLD - x.gauge) / x.rate));
    for (const x of sim) x.gauge += x.rate * dt;
    let best: (typeof sim)[number] | null = null;
    for (const x of sim) {
      if (x.gauge < THRESHOLD) continue;
      if (
        !best ||
        x.gauge > best.gauge ||
        (x.gauge === best.gauge && (x.rate > best.rate || (x.rate === best.rate && (x.side === first && best.side !== first || (x.side === best.side && x.uid < best.uid)))))
      ) {
        best = x;
      }
    }
    best!.gauge -= THRESHOLD;
    out.push(best!.uid);
  }
  return out;
}
