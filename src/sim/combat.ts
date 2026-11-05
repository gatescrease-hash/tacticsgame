import { computePacket, powerOf } from "./damage.js";
import { afterDamage, firePassives, heal, loseHp } from "./effects.js";
import { hasLineOfSight, manhattan } from "./grid.js";
import { clamp, idiv } from "./math.js";
import { emit, rngFor, unitAt, type BattleState } from "./state.js";
import { addBuildup, applyStatus, isFrozen } from "./statuses.js";
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
      tags: w.range.max <= 1 ? ["basic", "melee"] : ["basic", "ranged"],
    };
    basicCache.set(u.weapon, a);
  }
  return a;
}

export function isReady(s: BattleState, u: Unit, a: AbilityDef): boolean {
  return (u.cooldowns[a.id] ?? 0) <= s.t;
}

/** Range in tiles plus line of sight for anything beyond adjacent. */
export function inRangeFrom(s: BattleState, u: Unit, a: AbilityDef, from: Pos, target: Unit): boolean {
  if (a.target === "self") return target === u;
  const d = manhattan(from, target.pos);
  if (d < a.range.min || d > a.range.max) return false;
  return d <= 1 || hasLineOfSight(s.grid, from, target.pos);
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

/** Probability (percent) that an attack-check ability lands. */
export function landChance(c: StageChances): number {
  return idiv(c.aim * (100 - c.dodge) * (100 - c.parry) * (100 - c.block), 1_000_000);
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
  const draws = s.rules.unitStreams ? [rng.int(100), rng.int(100), rng.int(100), rng.int(100), rng.int(100), rng.int(100)] : null;
  let k = 0;
  const roll = (pct: number) => (draws ? draws[k++]! < pct : rng.chance(pct));

  if (a.check === "attack" && hostile) {
    const c = stageChances(u, v, a, distance);
    let outcome: AttackOutcome | null = null;
    if (!roll(c.aim)) outcome = "missed";
    else if (roll(c.dodge)) outcome = "dodged";
    else if (roll(c.parry)) outcome = "parried";
    else if (roll(c.block)) outcome = "blocked";
    if (outcome) {
      emit(s, { t: s.t, kind: "hit", uid: u.uid, target: v.uid, ability: a.id, outcome, crit: false, components: [], damage: 0, hpAfter: v.hp });
      if (!counter) firePassives(s, v, "onBeingAttacked", u, reactCtx);
      return;
    }
    crit = roll(critChance(u, v));
  }

  // Armour stage: every damage effect is a packet resolved per component.
  const damageEffects = a.effects.filter((e) => e.kind === "damage");
  let total = 0;
  if (damageEffects.length > 0) {
    const sp = s.rules.damageSpread;
    const spread = sp > 0 ? 100 - sp + (draws ? draws[5]! % (2 * sp + 1) : rng.int(2 * sp + 1)) : 100;
    const components: ComponentResult[] = [];
    let interaction: string | undefined;
    for (const e of damageEffects) {
      const r = computePacket(u, v, e.packet, e.power, crit, spread);
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
  for (let k = 0; k < tiles; k++) {
    const next = { x: target.pos.x + dir.x, y: target.pos.y + dir.y };
    if (!s.grid.inBounds(next) || s.grid.tile(next).blocked || unitAt(s, next)) break;
    target.pos = next;
  }
  if (target.pos.x !== from.x || target.pos.y !== from.y) {
    emit(s, { t: s.t, kind: "push", uid: target.uid, from, to: { ...target.pos } });
  }
}
