import type { Pos, Unit } from "./types.js";

/**
 * Squad formation. The player chooses roughly where the squad stands (which
 * flank, which piece of ground); the squad sorts out the exact tiles itself by
 * role, so the outcome doesn't hinge on A4 versus A5.
 */

/** 0 = front line, 1 = middle (support), 2 = back line (ranged/casters). */
export function roleRank(u: Unit): 0 | 1 | 2 {
  const t = u.cls.tags;
  if (t.includes("ranged") || t.includes("caster")) return 2;
  if (t.includes("healer") || t.includes("support")) return 1;
  return 0;
}

/** Desired distance in front of the anchor, per rank. */
const DESIRED_FORWARD = [1, 0, -1] as const;

/**
 * Rearrange `squad` on `tiles` (allowed, free tiles), centred on the squad's
 * current centroid and facing `toward`. Deterministic: units pick in rank then
 * uid order; ties break by tile order.
 */
export function arrangeFormation(squad: Unit[], tiles: Pos[], toward: Pos): void {
  if (squad.length === 0 || tiles.length < squad.length) return;
  const anchor = {
    x: Math.round(squad.reduce((a, u) => a + u.pos.x, 0) / squad.length),
    y: Math.round(squad.reduce((a, u) => a + u.pos.y, 0) / squad.length),
  };
  const dx = toward.x - anchor.x;
  const dy = toward.y - anchor.y;
  // Facing along the dominant axis toward the enemy.
  const dir = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) };
  const forward = (p: Pos) => (p.x - anchor.x) * dir.x + (p.y - anchor.y) * dir.y;
  const lateral = (p: Pos) => Math.abs((p.x - anchor.x) * dir.y - (p.y - anchor.y) * dir.x);

  const order = [...squad].sort((a, b) => roleRank(a) - roleRank(b) || a.uid - b.uid);
  const taken = new Set<number>();
  for (const u of order) {
    const want = DESIRED_FORWARD[roleRank(u)];
    let best = -1;
    let bestCost = Infinity;
    tiles.forEach((p, i) => {
      if (taken.has(i)) return;
      // Stay compact (lateral) and in your rank's line (forward).
      const cost = 3 * Math.abs(forward(p) - want) + 2 * lateral(p);
      if (cost < bestCost) {
        bestCost = cost;
        best = i;
      }
    });
    taken.add(best);
    u.pos = { ...tiles[best]! };
  }
}
