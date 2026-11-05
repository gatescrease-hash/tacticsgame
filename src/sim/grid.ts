import type { Pos } from "./types.js";

export interface Tile {
  blocked: boolean;
  blocksSight: boolean;
  /** Multiplier on movement cost to enter this tile (1 = normal). */
  moveMult: number;
}

const TILE_KINDS: Record<string, Tile> = {
  ".": { blocked: false, blocksSight: false, moveMult: 1 },
  "#": { blocked: true, blocksSight: true, moveMult: 1 },
  "~": { blocked: false, blocksSight: false, moveMult: 2 },
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
 * Dijkstra over movement cost from `start`. `isFree` decides which tiles can be
 * entered (e.g. not occupied). Returns cost and predecessor per tile index.
 * Grids are small, so a simple O(n^2) frontier scan is fine for now.
 */
export function pathCosts(
  grid: Grid,
  start: Pos,
  moveCost: number,
  isFree: (p: Pos) => boolean,
): { cost: Int32Array; prev: Int32Array } {
  const n = grid.width * grid.height;
  const cost = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  cost[grid.index(start)] = 0;

  for (;;) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      const c = cost[i]!;
      if (c >= 0 && !done[i] && (best < 0 || c < cost[best]!)) best = i;
    }
    if (best < 0) break;
    done[best] = 1;
    const here = grid.posOf(best);
    for (const q of grid.neighbours(here)) {
      const t = grid.tile(q);
      if (t.blocked || !isFree(q)) continue;
      const qi = grid.index(q);
      const c = cost[best]! + moveCost * t.moveMult;
      if (cost[qi]! < 0 || c < cost[qi]!) {
        cost[qi] = c;
        prev[qi] = best;
      }
    }
  }
  return { cost, prev };
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
