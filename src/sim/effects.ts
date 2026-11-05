import { applyEffect, basicAttack, executeAbility, inRangeFrom } from "./combat.js";
import { manhattan } from "./grid.js";
import { emit, type BattleState } from "./state.js";
import { applyStatus, isFrozen } from "./statuses.js";
import { maxHp, stat } from "./stats.js";
import type { Reason, TriggerKind, Unit } from "./types.js";

/** HP changes, knockouts, morale and the trigger dispatcher. */

export function loseHp(u: Unit, amount: number): number {
  u.hp = Math.max(0, u.hp - amount);
  return u.hp;
}

/** Call after any HP loss has been logged: thresholds, morale, knockouts. */
export function afterDamage(s: BattleState, u: Unit, sourceUid: number): void {
  if (!u.alive) return;
  if (u.hp <= 0) {
    knockout(s, u, sourceUid);
    return;
  }
  const max = maxHp(u);
  if (!u.hpFlags.below50 && u.hp * 2 <= max) {
    u.hpFlags.below50 = true;
    moraleCheck(s, u, 50);
    firePassives(s, u, "onHpBelow50");
  }
  if (u.alive && !u.hpFlags.below25 && u.hp * 4 <= max) {
    u.hpFlags.below25 = true;
    moraleCheck(s, u, 25);
    firePassives(s, u, "onHpBelow25");
  }
}

export function heal(s: BattleState, src: Unit, target: Unit, amount: number): void {
  const max = maxHp(target);
  const actual = Math.min(amount, max - target.hp);
  if (actual <= 0) return;
  target.hp += actual;
  emit(s, { t: s.t, kind: "heal", uid: src.uid, target: target.uid, amount: actual, hpAfter: target.hp });
  // Healed back up: thresholds re-arm.
  if (target.hp * 2 > max) target.hpFlags.below50 = false;
  if (target.hp * 4 > max) target.hpFlags.below25 = false;
}

function knockout(s: BattleState, u: Unit, by: number): void {
  u.alive = false;
  u.statuses = [];
  emit(s, { t: s.t, kind: "knockout", uid: u.uid, by });
  for (const ally of s.units) {
    if (ally.alive && ally.side === u.side && manhattan(ally.pos, u.pos) <= 2) {
      firePassives(s, ally, "onAllyKnockedOut", u);
    }
  }
}

/**
 * HP thresholds are where personality kicks in. Traits decide what a unit
 * wants; Resolve decides whether it holds together. Deterministic, no roll.
 */
function moraleCheck(s: BattleState, u: Unit, threshold: 50 | 25): void {
  if (!u.race.profile.mind) return;
  const score = stat(u, "resolve") + u.traits.reduce((a, t) => a + t.resolve, 0);
  const need = threshold === 50 ? 6 : 10;
  if (score < need) {
    const result = u.traits.find((t) => t.onBreak)?.onBreak ?? "shaken";
    applyStatus(s, u, result, u.uid);
    say(s, u, result, true);
  } else if (threshold === 25) {
    say(s, u, "steady", true);
  }
}

/** Speech bubbles: short in-character lines explaining an action. */
export function say(s: BattleState, u: Unit, reason: Reason, force = false): void {
  if (!force && u.lastReason === reason) return;
  u.lastReason = reason;
  let lines: string[] | undefined;
  for (const t of u.traits) lines ??= t.lines?.[reason];
  lines ??= s.content.voice[reason];
  if (!lines || lines.length === 0) return;
  const text = lines[(s.t + u.uid * 7) % lines.length]!;
  emit(s, { t: s.t, kind: "say", uid: u.uid, text, reason });
}

export interface TriggerContext {
  melee?: boolean;
  suppressed?: boolean;
}

/** Passives are effects attached to triggers; counters, poison blades and rallies share one path. */
export function firePassives(s: BattleState, u: Unit, trigger: TriggerKind, other?: Unit, ctx: TriggerContext = {}): void {
  if (!u.alive) return;
  for (const p of u.passives) {
    if (p.trigger !== trigger) continue;
    if (p.once && u.firedOnce.has(p.id)) continue;
    if (p.counter) {
      if (!other?.alive || ctx.suppressed || isFrozen(u)) continue;
      const atk = basicAttack(u);
      if (!inRangeFrom(s, u, atk, u.pos, other)) continue;
      if (p.say) emitPassiveSay(s, u, p.say);
      else say(s, u, "counter", true);
      executeAbility(s, u, atk, other, { counter: true });
    } else if (p.effects) {
      const target = p.effectTarget === "other" ? other : u;
      if (!target?.alive) continue;
      if (p.say) emitPassiveSay(s, u, p.say);
      for (const e of p.effects) applyEffect(s, u, target, e, p.id);
    }
    if (p.once) u.firedOnce.add(p.id);
    if (!u.alive) return;
  }
}

function emitPassiveSay(s: BattleState, u: Unit, lines: string[]): void {
  const text = lines[(s.t + u.uid * 7) % lines.length]!;
  emit(s, { t: s.t, kind: "say", uid: u.uid, text, reason: "counter" });
}
