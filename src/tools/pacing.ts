import type { BattleLog, Pos } from "../sim/index.js";

/**
 * How a battle *looks*: how turns are spent and how big the hits are. Pure (reads only
 * the log), shared by `npm run pacing` and the browser's tuning panel.
 */
export interface Pacing {
  /** Ticks until the first damage landed (battle length if none did). */
  first: number;
  /** Battle length in ticks. */
  length: number;
  /** Turns: ability used, step toward / away from / level with the nearest enemy, hold. */
  act: number;
  toward: number;
  away: number;
  side: number;
  wait: number;
  /** Steps straight back onto the tile just left (ping-pong). */
  flip: number;
  /** Damaging hits and their summed size as % of the target's max HP. */
  hits: number;
  hitPct: number;
  /** Units x ticks, for per-unit action rates. */
  unitTicks: number;
}

export function emptyPacing(): Pacing {
  return { first: 0, length: 0, act: 0, toward: 0, away: 0, side: 0, wait: 0, flip: 0, hits: 0, hitPct: 0, unitTicks: 0 };
}

const md = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function pacingOf(log: BattleLog): Pacing {
  const r = emptyPacing();
  const start = log[0];
  if (!start || start.kind !== "start") return r;
  const pos = new Map(start.units.map((u) => [u.uid, { ...u.pos }]));
  const side = new Map(start.units.map((u) => [u.uid, u.side]));
  const maxHp = new Map(start.units.map((u) => [u.uid, u.maxHp]));
  const alive = new Set(start.units.map((u) => u.uid));
  const lastFrom = new Map<number, string>();
  let first = -1;
  let end = 0;
  for (const e of log) {
    end = e.t;
    if (e.kind === "move") {
      const foes = [...alive].filter((o) => side.get(o) !== side.get(e.uid));
      const near = (p: Pos) => Math.min(...foes.map((o) => md(p, pos.get(o)!)));
      const d0 = near(e.from);
      const d1 = near(e.to);
      if (d1 < d0) r.toward++;
      else if (d1 > d0) r.away++;
      else r.side++;
      if (lastFrom.get(e.uid) === `${e.to.x},${e.to.y}`) r.flip++;
      lastFrom.set(e.uid, `${e.from.x},${e.from.y}`);
      pos.set(e.uid, { ...e.to });
    } else if (e.kind === "push") pos.set(e.uid, { ...e.to });
    else if (e.kind === "ability" && !e.counter) r.act++;
    else if (e.kind === "wait") r.wait++;
    else if (e.kind === "hit" && e.damage > 0) {
      if (first < 0) first = e.t;
      r.hitPct += (100 * e.damage) / maxHp.get(e.target)!;
      r.hits++;
    } else if (e.kind === "knockout") alive.delete(e.uid);
  }
  r.first = first < 0 ? end : first;
  r.length = end;
  r.unitTicks = start.units.length * end;
  return r;
}

export function addPacing(a: Pacing, b: Pacing): Pacing {
  const out = emptyPacing();
  for (const k of Object.keys(out) as (keyof Pacing)[]) out[k] = a[k] + b[k];
  return out;
}

/** One-line summary. `n` = number of battles summed into `p`. */
export function describePacing(p: Pacing, n = 1): string {
  const turns = Math.max(1, p.act + p.toward + p.away + p.side + p.wait);
  const pc = (x: number) => `${Math.round((100 * x) / turns)}%`;
  return (
    `act ${pc(p.act)} · toward ${pc(p.toward)} · away ${pc(p.away)} · wait ${pc(p.wait)} · ping-pong ${pc(p.flip)} · ` +
    `avg hit ${(p.hitPct / Math.max(1, p.hits)).toFixed(1)}% of max HP · ${((100 * p.act) / Math.max(1, p.unitTicks)).toFixed(2)} actions/unit/100t · ` +
    `first blood t${Math.round(p.first / n)} · length t${Math.round(p.length / n)}`
  );
}
