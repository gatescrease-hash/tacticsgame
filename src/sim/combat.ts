import { computePacket, powerOf } from "./damage.js";
import { afterDamage, firePassives, heal, loseHp } from "./effects.js";
import { hasLineOfSight, manhattan } from "./grid.js";
import { clamp, idiv } from "./math.js";
import { emit, rngFor, unitAt, type BattleState, type Rules } from "./state.js";
import { addBuildup, applyStatus, isFrozen } from "./statuses.js";
import { isFlyer } from "./movement.js";
import { hasStatus, stat } from "./stats.js";
import type { AttackOutcome, ComponentResult } from "./log.js";
import type { AbilityDef, Effect, Pos, Unit } from "./types.js";

/**
 * Ability execution and the staged combat pipeline:
 * aim -> reaction -> armour -> effect. Abilities are data built from a small
 * set of effect pieces and targeting shapes.
 */

const basicCache = new WeakMap<object, AbilityDef>();

/** The weapon's plain attack, as an ability. */
export function basicAttack(u: Unit): AbilityDef {
  let a = basicCache.get(u.weapon);
  if (!a) {
    const w = u.weapon;
    a = {
      id: "attack",
      name: w.name,
      cost: w.cost,
      cooldown: 0,
      range: w.range,
      target: "enemy",
      shape: { kind: "single" },
      affects: "enemies",
      check: "attack",
      effects: [{ kind: "damage", packet: w.packet, power: { weapon: true, base: 0 } }],
      // Bows and crossbows (minimum range 2+) shoot; everything else, spears included, is melee.
      tags: w.range.min >= 2 ? ["basic", "ranged"] : ["basic", "melee"],
    };
    basicCache.set(u.weapon, a);
  }
  return a;
}

export function isReady(s: BattleState, u: Unit, a: AbilityDef): boolean {
  return (u.cooldowns[a.id] ?? 0) <= s.t;
}

/** Range in tiles plus line of sight for anything beyond adjacent. */
/** Ranged attacks and spells: no height limit, and they enjoy high ground. Everything else is melee. */
export function isRangedAbility(a: AbilityDef): boolean {
  return a.tags.includes("ranged") || a.tags.includes("spell");
}

/** Metres above the target that count as high ground (+1 range for ranged attacks). */
export const HIGH_GROUND = 2;

/**
 * Range in tiles, height and line of sight. Melee only connects across a height
 * difference of 1 m (reach weapons: their max range in metres). Ranged attacks
 * get +1 range from 2 m above the target.
 */
export function inRangeFrom(s: BattleState, u: Unit, a: AbilityDef, from: Pos, target: Unit): boolean {
  if (a.target === "self") return target === u;
  const d = manhattan(from, target.pos);
  const dh = s.grid.heightAt(from) - s.grid.heightAt(target.pos);
  const ranged = isRangedAbility(a);
  const maxRange = a.range.max + (ranged && dh >= HIGH_GROUND ? 1 : 0);
  if (d < a.range.min || d > maxRange) return false;
  if (!ranged && Math.abs(dh) > Math.max(1, a.range.max)) return false;
  return d <= 1 || hasLineOfSight(s.grid, from, target.pos);
}

/** Ranged damage from high ground: +10% per metre above the target, -10% per metre below (max 20%). */
export function elevationPct(grid: BattleState["grid"], from: Pos, to: Pos, a: AbilityDef): number {
  if (!isRangedAbility(a)) return 100;
  return 100 + clamp((grid.heightAt(from) - grid.heightAt(to)) * 10, -20, 20);
}

function lineDir(from: Pos, to: Pos): Pos {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return { x: Math.sign(dx), y: 0 };
  return { x: 0, y: Math.sign(dy) };
}

/** Units inside an ability's shape when aimed at `target` from `from`. */
export function affected(s: BattleState, u: Unit, a: AbilityDef, target: Unit, from: Pos = u.pos): Unit[] {
  let inShape: Unit[];
  switch (a.shape.kind) {
    case "single":
      inShape = [target];
      break;
    case "radius": {
      const r = a.shape.r;
      inShape = s.units.filter((v) => v.alive && manhattan(v.pos, target.pos) <= r);
      break;
    }
    case "line": {
      const dir = lineDir(from, target.pos);
      inShape = [];
      for (let k = 1; k <= a.shape.length; k++) {
        const v = unitAt(s, { x: from.x + dir.x * k, y: from.y + dir.y * k });
        if (v) inShape.push(v);
      }
      break;
    }
  }
  return inShape.filter((v) => {
    if (a.affects === "all") return v !== u || a.target === "self";
    return a.affects === "enemies" ? v.side !== u.side : v.side === u.side;
  });
}

export interface StageChances {
  aim: number;
  dodge: number;
  parry: number;
  block: number;
}

export function stageChances(att: Unit, def: Unit, a: AbilityDef, distance: number): StageChances {
  const melee = distance <= 1;
  const parryable = melee && def.weapon.canParry && !att.weapon.ignoresParry && !a.tags.includes("suppress") && !isFrozen(def);
  const frozen = isFrozen(def);
  return {
    aim: clamp(stat(att, "hit"), 5, 99),
    dodge: frozen ? 0 : clamp(stat(def, "dodge") - stat(att, "skill"), 0, 60),
    parry: parryable ? clamp(stat(def, "parry") - stat(att, "skill"), 0, 50) : 0,
    block: frozen ? 0 : clamp(stat(def, "block"), 0, 50),
  };
}

/** Dice tables: DICE[n][p] = chance (percent x 100) that the average of n d100s (0-99) is below p. */
const diceTables = new Map<number, number[]>();
function diceTable(n: number): number[] {
  let t = diceTables.get(n);
  if (t) return t;
  let dist = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array<number>(dist.length + 99).fill(0);
    dist.forEach((c, sIdx) => {
      for (let d = 0; d < 100; d++) next[sIdx + d]! += c;
    });
    dist = next;
  }
  const total = 100 ** n;
  t = [];
  for (let p = 0; p <= 100; p++) {
    let below = 0;
    for (let sum = 0; sum < Math.min(dist.length, n * p); sum++) below += dist[sum]!;
    t.push(Math.round((below * 10_000) / total));
  }
  diceTables.set(n, t);
  return t;
}

export type LuckRules = Pick<Rules, "luck" | "hitDice">;

/** The real long-run probability (percent) behind a displayed chance. */
export function realChance(pct: number, luck?: LuckRules): number {
  const p = clamp(pct, 0, 100);
  if (!luck || luck.luck === "meter" || luck.hitDice <= 1) return p;
  return idiv(diceTable(luck.hitDice)[p]!, 100);
}

/** Probability (percent) that an attack-check ability lands. */
export function landChance(c: StageChances, luck?: LuckRules): number {
  const r = (p: number) => realChance(p, luck);
  return idiv(r(c.aim) * (100 - r(c.dodge)) * (100 - r(c.parry)) * (100 - r(c.block)), 1_000_000);
}

/** Bounded luck: add the chance to the unit's meter; succeed when it passes 100. */
function meterRoll(owner: Unit, key: string, pct: number): boolean {
  const m = (owner.meters[key] ?? 50) + clamp(pct, 0, 100);
  if (m >= 100) {
    owner.meters[key] = m - 100;
    return true;
  }
  owner.meters[key] = m;
  return false;
}

export function critChance(att: Unit, def: Unit): number {
  return clamp(stat(att, "crit") - idiv(stat(def, "luck"), 4), 0, 50);
}

export interface ExecuteOptions {
  /** A free reaction (counterattack): no gauge cost, can't itself be countered. */
  counter?: boolean;
}

export function executeAbility(s: BattleState, u: Unit, a: AbilityDef, target: Unit, opts: ExecuteOptions = {}): void {
  const counter = opts.counter ?? false;
  if (!counter) {
    u.gauge -= a.cost;
    if (a.cooldown > 0) u.cooldowns[a.id] = s.t + a.cooldown;
  }
  emit(s, {
    t: s.t,
    kind: "ability",
    uid: u.uid,
    ability: a.id,
    abilityName: a.name,
    target: target.uid,
    at: { ...target.pos },
    cost: counter ? 0 : a.cost,
    counter,
  });
  if (a.say && !counter) {
    emit(s, { t: s.t, kind: "say", uid: u.uid, text: a.say[(s.t + u.uid) % a.say.length]!, reason: "aoe" });
  }
  for (const v of affected(s, u, a, target)) {
    if (!u.alive) break;
    if (v.alive) resolveOn(s, u, a, v, counter);
  }
}

function resolveOn(s: BattleState, u: Unit, a: AbilityDef, v: Unit, counter: boolean): void {
  const distance = manhattan(u.pos, v.pos);
  const hostile = v.side !== u.side;
  const reactCtx = { melee: distance <= 1, suppressed: a.tags.includes("suppress") };
  let crit = false;

  // Rolls come from the attacker's stream. With per-unit streams every attack
  // draws the same number of rolls, so one outcome doesn't shift later luck.
  const rng = rngFor(s, u);
  const meters = s.rules.luck === "meter";
  const n = Math.max(1, s.rules.hitDice);
  // Fixed layout when streams are on: stage i uses slots [i*n, i*n+n), crit 4n, spread 4n+1.
  const draws = s.rules.unitStreams && !meters ? Array.from({ length: 4 * n + 2 }, () => rng.int(100)) : null;
  let k = 0;
  const d100 = () => (draws ? draws[k++]! : rng.int(100));
  const roll = (stage: number, owner: Unit, key: string, pct: number): boolean => {
    if (meters) return meterRoll(owner, key, pct);
    if (draws) k = stage * n;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d100();
    return sum < n * pct;
  };

  if (a.check === "attack" && hostile) {
    const c = stageChances(u, v, a, distance);
    let outcome: AttackOutcome | null = null;
    if (!roll(0, u, "aim", c.aim)) outcome = "missed";
    else if (roll(1, v, "dodge", c.dodge)) outcome = "dodged";
    else if (roll(2, v, "parry", c.parry)) outcome = "parried";
    else if (roll(3, v, "block", c.block)) outcome = "blocked";
    if (outcome) {
      emit(s, { t: s.t, kind: "hit", uid: u.uid, target: v.uid, ability: a.id, outcome, crit: false, components: [], damage: 0, hpAfter: v.hp });
      if (!counter) firePassives(s, v, "onBeingAttacked", u, reactCtx);
      return;
    }
    const cc = critChance(u, v);
    if (meters) crit = meterRoll(u, "crit", cc);
    else {
      if (draws) k = 4 * n;
      crit = d100() < cc;
    }
  }

  // Armour stage: every damage effect is a packet resolved per component.
  const damageEffects = a.effects.filter((e) => e.kind === "damage");
  let total = 0;
  if (damageEffects.length > 0) {
    const sp = s.rules.damageSpread;
    const spread = sp > 0 ? 100 - sp + (draws ? draws[4 * n + 1]! % (2 * sp + 1) : rng.int(2 * sp + 1)) : 100;
    const components: ComponentResult[] = [];
    let interaction: string | undefined;
    for (const e of damageEffects) {
      const r = computePacket(u, v, e.packet, e.power, crit, idiv(spread * elevationPct(s.grid, u.pos, v.pos, a), 100));
      total += r.total;
      components.push(...r.components);
      interaction ??= r.interaction;
    }
    const spreads = damageEffects.some((e) => e.packet.some((c) => c.element === "wind")) && hasStatus(v, "burning");
    if (spreads) interaction = "spread";
    const hpAfter = loseHp(v, total);
    emit(s, {
      t: s.t,
      kind: "hit",
      uid: u.uid,
      target: v.uid,
      ability: a.id,
      outcome: total > 0 ? "hit" : "glanced off",
      crit,
      components,
      damage: total,
      hpAfter,
      ...(interaction ? { interaction } : {}),
    });
    if (spreads) {
      // Burning plus wind spreads to neighbouring tiles.
      for (const n of s.units) if (n.alive && n !== v && manhattan(n.pos, v.pos) === 1) addBuildup(s, n, "burning", 100, u.uid);
    }
  }

  // Effect stage. Riders only land if the hit did (or there was no damage part).
  if (damageEffects.length === 0 || total > 0) {
    for (const e of a.effects) if (e.kind !== "damage") applyEffect(s, u, v, e, a.id);
  }

  if (total > 0) {
    afterDamage(s, v, u.uid);
    firePassives(s, u, "onHit", v);
    if (v.alive) firePassives(s, v, "onBeingHit", u);
  }
  if (hostile && !counter && v.alive) firePassives(s, v, "onBeingAttacked", u, reactCtx);
}

/** One effect piece, no checks. Used by ability riders and passives. */
export function applyEffect(s: BattleState, src: Unit, target: Unit, e: Effect, sourceId: string): void {
  if (!target.alive) return;
  switch (e.kind) {
    case "damage": {
      const r = computePacket(src, target, e.packet, e.power, false);
      const hpAfter = loseHp(target, r.total);
      emit(s, {
        t: s.t,
        kind: "hit",
        uid: src.uid,
        target: target.uid,
        ability: sourceId,
        outcome: r.total > 0 ? "hit" : "glanced off",
        crit: false,
        components: r.components,
        damage: r.total,
        hpAfter,
      });
      if (r.total > 0) afterDamage(s, target, src.uid);
      return;
    }
    case "buildup":
      addBuildup(s, target, e.status, e.amount, src.uid);
      return;
    case "status":
      applyStatus(s, target, e.status, src.uid);
      return;
    case "gauge":
      target.gauge += e.amount;
      emit(s, { t: s.t, kind: "gauge", uid: src.uid, target: target.uid, amount: e.amount });
      return;
    case "heal":
      heal(s, src, target, powerOf(src, e.power));
      return;
    case "push":
      push(s, src, target, e.tiles);
      return;
  }
}

function push(s: BattleState, src: Unit, target: Unit, tiles: number): void {
  const dir = lineDir(src.pos, target.pos);
  const from = { ...target.pos };
  let fell = false;
  for (let k = 0; k < tiles; k++) {
    const next = { x: target.pos.x + dir.x, y: target.pos.y + dir.y };
    if (!s.grid.inBounds(next) || unitAt(s, next)) break;
    const t = s.grid.tile(next);
    // Knocked into a bottomless pit: gone (flyers just flutter).
    if (t.pit && !isFlyer(target)) {
      target.pos = next;
      fell = true;
      break;
    }
    // Can't be shoved up a step higher than 1 m.
    if (t.blocked || s.grid.heightAt(next) - s.grid.heightAt(target.pos) > 1) break;
    target.pos = next;
  }
  if (target.pos.x !== from.x || target.pos.y !== from.y) {
    emit(s, { t: s.t, kind: "push", uid: target.uid, from, to: { ...target.pos } });
  }
  if (fell) {
    const damage = target.hp;
    loseHp(target, damage);
    emit(s, { t: s.t, kind: "dot", uid: target.uid, status: "fall", damage, hpAfter: 0 });
    afterDamage(s, target, src.uid);
  }
}
