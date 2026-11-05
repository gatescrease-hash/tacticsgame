import type { Pos } from "./types.js";

export interface Tile {
  blocked: boolean;
  blocksSight: boolean;
  /** Percent multiplier on movement cost to enter this tile (100 = normal). */
  moveMult: number;
  /** Swamp-like terrain that swampwalkers cross at normal cost. */
  swamp: boolean;
}

export const TILE_KINDS: Record<string, Tile> = {
  ".": { blocked: false, blocksSight: false, moveMult: 100, swamp: false },
  "#": { blocked: true, blocksSight: true, moveMult: 100, swamp: false },
  "~": { blocked: false, blocksSight: false, moveMult: 200, swamp: true },
  '"': { blocked: false, blocksSight: true, moveMult: 150, swamp: false },
};

export class Grid {
  readonly width: number;
  readonly height: number;
  private readonly tiles: Tile[];

  constructor(rows: string[]) {
    this.height = rows.length;
    this.width = rows[0]?.length ?? 0;
    this.tiles = [];
    for (const [y, row] of rows.entries()) {
      if (row.length !== this.width) throw new Error(`map row ${y} has length ${row.length}, expected ${this.width}`);
      for (const ch of row) {
        const t = TILE_KINDS[ch];
        if (!t) throw new Error(`unknown map tile '${ch}' in row ${y}`);
        this.tiles.push(t);
      }
    }
  }

  inBounds(p: Pos): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  tile(p: Pos): Tile {
    const t = this.tiles[p.y * this.width + p.x];
    if (!t) throw new Error(`tile out of bounds: ${p.x},${p.y}`);
    return t;
  }

  tileAt(index: number): Tile {
    return this.tiles[index]!;
  }

  index(p: Pos): number {
    return p.y * this.width + p.x;
  }

  posOf(index: number): Pos {
    return { x: index % this.width, y: Math.floor(index / this.width) };
  }

  /** 4-neighbours in a fixed order (N, E, S, W) so pathing is deterministic. */
  neighbours(p: Pos): Pos[] {
    const out: Pos[] = [];
    for (const [dx, dy] of DIRS) {
      const q = { x: p.x + dx, y: p.y + dy };
      if (this.inBounds(q)) out.push(q);
    }
    return out;
  }
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function samePos(a: Pos, b: Pos): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Dijkstra over movement cost from `start`, with a binary heap. `isFree`
 * decides which tiles can be entered (e.g. not occupied). Returns cost (-1 =
 * unreachable), predecessor per tile index, and tiles in cost order. Neighbour order is fixed
 * (N, E, S, W) so results are deterministic.
 */
export function pathCosts(
  grid: Grid,
  start: Pos,
  stepCost: (to: Pos, tile: Tile) => number,
  isFree: (p: Pos) => boolean,
  maxCost = Infinity,
): { cost: Int32Array; prev: Int32Array; order: number[] } {
  const w = grid.width;
  const n = w * grid.height;
  const cost = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  /** Tiles in the order they were finalized: non-decreasing cost, ties by index. */
  const order: number[] = [];
  // Heap of (cost, index) packed as parallel arrays; ties broken by index for determinism.
  const hc: number[] = [];
  const hi: number[] = [];
  const less = (a: number, b: number) => hc[a]! < hc[b]! || (hc[a] === hc[b] && hi[a]! < hi[b]!);
  const swap = (a: number, b: number) => {
    [hc[a], hc[b]] = [hc[b]!, hc[a]!];
    [hi[a], hi[b]] = [hi[b]!, hi[a]!];
  };
  const push = (c: number, i: number) => {
    hc.push(c);
    hi.push(i);
    let k = hc.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!less(k, p)) break;
      swap(k, p);
      k = p;
    }
  };
  const pop = (): number => {
    const top = hi[0]!;
    const lc = hc.pop()!;
    const li = hi.pop()!;
    if (hc.length > 0) {
      hc[0] = lc;
      hi[0] = li;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < hc.length && less(l, m)) m = l;
        if (r < hc.length && less(r, m)) m = r;
        if (m === k) break;
        swap(k, m);
        k = m;
      }
    }
    return top;
  };

  const s0 = grid.index(start);
  cost[s0] = 0;
  push(0, s0);
  const q = { x: 0, y: 0 };
  while (hc.length > 0) {
    const cur = pop();
    if (done[cur]) continue;
    done[cur] = 1;
    order.push(cur);
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (let d = 0; d < 4; d++) {
      const nx = cx + DIRS[d]![0];
      const ny = cy + DIRS[d]![1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= grid.height) continue;
      const qi = ny * w + nx;
      if (done[qi]) continue;
      q.x = nx;
      q.y = ny;
      const t = grid.tileAt(qi);
      if (t.blocked || !isFree(q)) continue;
      const c = cost[cur]! + stepCost(q, t);
      if (c > maxCost) continue;
      if (cost[qi]! < 0 || c < cost[qi]!) {
        cost[qi] = c;
        prev[qi] = cur;
        push(c, qi);
      }
    }
  }
  return { cost, prev, order };
}

/** First step from start toward `goal` using a `prev` table from pathCosts. */
export function firstStep(grid: Grid, prev: Int32Array, start: Pos, goal: Pos): Pos | null {
  const startI = grid.index(start);
  let i = grid.index(goal);
  if (i === startI) return null;
  while (prev[i]! !== startI) {
    i = prev[i]!;
    if (i < 0) return null;
  }
  return grid.posOf(i);
}

/**
 * Line of sight between tile centres: no sight-blocking tile strictly between
 * them (Bresenham). Adjacent tiles always see each other.
 */
export function hasLineOfSight(grid: Grid, a: Pos, b: Pos): boolean {
  let x0 = a.x;
  let y0 = a.y;
  const dx = Math.abs(b.x - x0);
  const dy = -Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1;
  const sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 === b.x && y0 === b.y) return true;
    if (!(x0 === a.x && y0 === a.y) && grid.tile({ x: x0, y: y0 }).blocksSight) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
