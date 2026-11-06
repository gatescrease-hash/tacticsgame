import { idiv } from "./math.js";
import type { Grid, Tile } from "./grid.js";
import type { ModKey, Modifier, Pos, Unit } from "./types.js";

/**
 * The modifier stack. Every value is calculated from layered sources in a
 * fixed order: base (personal + race) -> flat bonuses -> percentages -> caps.
 * Sources today: class base bonus, gear, passives, statuses. Progression and
 * training will just add more sources.
 */

/** Soft cap: speed above this only counts half (runaway speed). */
const SPEED_SOFT_CAP = 12;

function baseValue(u: Unit, key: ModKey): number {
  switch (key) {
    case "hit":
      return 60 + 2 * stat(u, "skill") + u.weapon.accuracy;
    case "dodge":
      return 2 * stat(u, "agility");
    case "parry":
      return u.weapon.canParry ? stat(u, "skill") + stat(u, "agility") : 0;
    case "block":
      return 0;
    case "crit":
      return idiv(stat(u, "skill"), 2) + idiv(stat(u, "luck"), 4);
    case "armour":
      return u.cls.armour.value;
    case "moveCost":
      return u.cls.moveCost;
    case "fillRate": {
      const speed = stat(u, "speed");
      const soft = speed > SPEED_SOFT_CAP ? SPEED_SOFT_CAP + idiv(speed - SPEED_SOFT_CAP, 2) : speed;
      // Heavy armour slows the gauge unless Strength carries it.
      const penalty = Math.max(0, u.cls.armour.weight - idiv(stat(u, "strength"), 4));
      return soft - penalty;
    }
    case "damageDealt":
    case "damageTaken":
      return 100;
    case "tactics":
      return u.tacticsBase;
    default:
      return u.base[key];
  }
}

function minimum(key: ModKey): number {
  switch (key) {
    case "fillRate":
      return 1;
    case "moveCost":
      return 5;
    case "hp":
      return 1;
    default:
      return 0;
  }
}

function* modifiersOf(u: Unit): Generator<Modifier> {
  yield* u.staticMods;
  yield* u.situationalMods;
  for (const s of u.statuses) if (s.def.mods) yield* s.def.mods;
}

/** A unit's current value for a stat or derived key. Cached until statuses change. */
export function stat(u: Unit, key: ModKey): number {
  const cached = u.cache.get(key);
  if (cached !== undefined) return cached;
  let v = baseValue(u, key);
  let pct = 0;
  let cap = Infinity;
  for (const m of modifiersOf(u)) {
    if (m.key !== key) continue;
    if (m.op === "flat") v += m.value;
    else if (m.op === "pct") pct += m.value;
    else cap = Math.min(cap, m.value);
  }
  v = idiv(v * (100 + pct), 100);
  v = Math.max(minimum(key), Math.min(cap, v));
  if (key === "tactics") v = Math.min(100, v);
  u.cache.set(key, v);
  return v;
}

export function maxHp(u: Unit): number {
  return stat(u, "hp");
}

export function invalidate(u: Unit): void {
  u.cache.clear();
}

/** Gauge cost to step onto a tile. */
export function stepCost(u: Unit, tile: Tile): number {
  const mult = tile.swamp && u.race.moveTags?.includes("swampwalker") ? 100 : tile.moveMult;
  return idiv(stat(u, "moveCost") * mult, 100);
}

export function stepCostAt(u: Unit, grid: Grid, p: Pos): number {
  return stepCost(u, grid.tile(p));
}

export function hasStatusTag(u: Unit, tag: string): boolean {
  return u.statuses.some((s) => s.def.tags?.includes(tag));
}

export function hasStatus(u: Unit, id: string): boolean {
  return u.statuses.some((s) => s.def.id === id);
}
