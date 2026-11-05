import type { Unit } from "./types.js";

/** Gauge threshold at which a unit acts. */
export const THRESHOLD = 100;

/** Effective gauge fill per tick. Diminishing returns / armour slow go here later. */
export function fillRate(u: Unit): number {
  return Math.max(1, u.stats.speed);
}

/** Opening initiative: seeded by speed so fast units still tend to go first. */
export function openingGauge(u: Unit): number {
  return Math.min(THRESHOLD - 1, u.stats.speed * 3);
}

/** Ticks until the earliest living unit reaches the threshold (0 if one already has). */
export function ticksToNextReady(units: Unit[]): number {
  let best = Infinity;
  for (const u of units) {
    if (!u.alive) continue;
    const need = THRESHOLD - u.gauge;
    const t = need <= 0 ? 0 : Math.ceil(need / fillRate(u));
    if (t < best) best = t;
  }
  return best;
}

export function advance(units: Unit[], ticks: number): void {
  for (const u of units) if (u.alive) u.gauge += fillRate(u) * ticks;
}

/**
 * The ready unit that acts next. Ties: higher gauge, then speed, then player
 * side, then uid. No randomness, so the same setup replays the same way.
 */
export function nextActor(units: Unit[]): Unit | null {
  let best: Unit | null = null;
  for (const u of units) {
    if (!u.alive || u.gauge < THRESHOLD) continue;
    if (!best || compare(u, best) < 0) best = u;
  }
  return best;
}

function compare(a: Unit, b: Unit): number {
  if (a.gauge !== b.gauge) return b.gauge - a.gauge;
  if (a.stats.speed !== b.stats.speed) return b.stats.speed - a.stats.speed;
  if (a.side !== b.side) return a.side === "player" ? -1 : 1;
  return a.uid - b.uid;
}
