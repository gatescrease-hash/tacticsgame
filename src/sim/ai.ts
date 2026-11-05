import { firstStep, manhattan, pathCosts } from "./grid.js";
import type { BattleState } from "./battle.js";
import type { Pos, Unit } from "./types.js";

/**
 * PLACEHOLDER BRAIN (build step 1). Walk to the nearest firing position and hit
 * the weakest enemy in range. Build step 3 replaces this with utility scoring:
 * candidate actions x weighted considerations, personality as the weights.
 */

export type Action =
  | { kind: "attack"; target: Unit }
  | { kind: "move"; to: Pos }
  | { kind: "wait" };

export function decide(state: BattleState, me: Unit): Action {
  const enemies = state.units.filter((u) => u.alive && u.side !== me.side);
  if (enemies.length === 0) return { kind: "wait" };
  const { min, max } = me.weapon.range;
  const inRange = (from: Pos, e: Unit) => {
    const d = manhattan(from, e.pos);
    return d >= min && d <= max;
  };

  // Attack the weakest enemy already in range.
  const targets = enemies.filter((e) => inRange(me.pos, e));
  if (targets.length > 0) {
    targets.sort((a, b) => a.hp - b.hp || manhattan(me.pos, a.pos) - manhattan(me.pos, b.pos) || a.uid - b.uid);
    return { kind: "attack", target: targets[0]! };
  }

  // Otherwise step toward the cheapest tile from which some enemy is in range.
  const occupied = new Set(state.units.filter((u) => u.alive && u !== me).map((u) => state.grid.index(u.pos)));
  const { cost, prev } = pathCosts(state.grid, me.pos, me.cls.moveCost, (p) => !occupied.has(state.grid.index(p)));
  let goal = -1;
  for (let i = 0; i < cost.length; i++) {
    const c = cost[i]!;
    if (c <= 0) continue; // unreachable, or our own tile
    const p = state.grid.posOf(i);
    if (!enemies.some((e) => inRange(p, e))) continue;
    if (goal < 0 || c < cost[goal]!) goal = i;
  }
  if (goal < 0) return { kind: "wait" };
  const step = firstStep(state.grid, prev, me.pos, state.grid.posOf(goal));
  return step ? { kind: "move", to: step } : { kind: "wait" };
}
