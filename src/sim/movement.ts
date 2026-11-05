import type { Grid } from "./grid.js";
import { idiv } from "./math.js";
import { stepCost } from "./stats.js";
import type { Pos, Unit } from "./types.js";

/**
 * Elevation and movement. Ground comes in whole metres:
 *  - stepping up 1 m is easy but costs +50% per metre climbed;
 *  - dropping down is fine up to jump + 1 metres;
 *  - climbing more than `jump` metres is impossible (default jump 1, so a
 *    2 m cliff stops most units);
 *  - jumpers (jump 2+) can also leap a single pit tile in a straight line;
 *  - flyers ignore height and pits.
 */

export function jumpOf(u: Unit): number {
  return Math.max(1, u.race.jump ?? 0, u.cls.jump ?? 0);
}

export function isFlyer(u: Unit): boolean {
  return u.race.moveTags?.includes("flyer") ?? false;
}

/** Whether this unit can ever leap pits (enables leap edges in pathfinding). */
export function canLeap(u: Unit): boolean {
  return isFlyer(u) || jumpOf(u) >= 2;
}

/** Gauge cost of one step from `from` to `to` (adjacent, or a 2-tile leap over a pit); -1 if impossible. */
export function edgeCost(u: Unit, grid: Grid, from: Pos, to: Pos): number {
  const t = grid.tile(to);
  const flyer = isFlyer(u);
  if (t.blocked && !(flyer && t.pit)) return -1;
  const dist = Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
  if (dist === 2) {
    const mid = grid.tile({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
    if (!mid.pit || !canLeap(u)) return -1;
  } else if (dist !== 1) {
    return -1;
  }
  const dh = grid.heightAt(to) - grid.heightAt(from);
  if (!flyer) {
    const jump = jumpOf(u);
    if (dh > jump || -dh > jump + 1) return -1;
  }
  let cost = stepCost(u, t);
  if (dist === 2) cost = idiv(cost * 5, 2); // a leap: a bit dearer than two plain steps
  if (dh > 0 && !flyer) cost += idiv(cost * 50 * dh, 100);
  return cost;
}
