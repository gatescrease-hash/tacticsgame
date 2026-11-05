import { afterDamage, loseHp } from "./effects.js";
import { idiv } from "./math.js";
import { emit, type BattleState } from "./state.js";
import { invalidate, stat } from "./stats.js";
import type { StatusDef, Unit } from "./types.js";

/**
 * Statuses build up, not roll: each hit fills a meter that triggers the status
 * at its threshold; resistances slow the meter. Predictable when the player
 * can't intervene.
 */

function statusDef(s: BattleState, id: string): StatusDef {
  const def = s.content.statuses[id];
  if (!def) throw new Error(`unknown status '${id}'`);
  return def;
}

export function isImmune(u: Unit, def: StatusDef): boolean {
  if (def.tags?.includes("fear") && !u.race.profile.mind) return true; // mindless things don't panic
  return def.immuneTags?.some((tag) => u.race.profile.tags.includes(tag)) ?? false;
}

export function addBuildup(s: BattleState, target: Unit, id: string, amount: number, sourceUid: number): void {
  const def = statusDef(s, id);
  if (!target.alive || isImmune(target, def)) return;
  const resist = stat(target, def.resistStat ?? "luck");
  const amt = idiv(amount * 100, 100 + 5 * resist);
  if (amt <= 0) return;
  const cur = (target.buildup[id] ?? 0) + amt;
  if (cur >= def.threshold) {
    target.buildup[id] = 0;
    applyStatus(s, target, id, sourceUid);
  } else {
    target.buildup[id] = cur;
  }
}

export function applyStatus(s: BattleState, target: Unit, id: string, sourceUid: number): void {
  const def = statusDef(s, id);
  if (!target.alive || isImmune(target, def)) return;
  for (const r of def.removes ?? []) removeStatus(s, target, r);
  const existing = target.statuses.find((x) => x.def.id === id);
  if (existing) {
    existing.expiresAt = s.t + def.duration;
    return;
  }
  target.statuses.push({
    def,
    expiresAt: s.t + def.duration,
    nextPulse: def.dot ? s.t + def.dot.every : Infinity,
    sourceUid,
  });
  invalidate(target);
  emit(s, { t: s.t, kind: "status", uid: target.uid, status: id, statusName: def.name, short: def.short, on: true });
}

export function removeStatus(s: BattleState, target: Unit, id: string): void {
  const i = target.statuses.findIndex((x) => x.def.id === id);
  if (i < 0) return;
  const [st] = target.statuses.splice(i, 1);
  invalidate(target);
  emit(s, { t: s.t, kind: "status", uid: target.uid, status: id, statusName: st!.def.name, short: st!.def.short, on: false });
}

/** Expire finished statuses and pulse damage-over-time that is due. */
export function updateStatuses(s: BattleState): void {
  for (const u of s.units) {
    if (!u.alive) continue;
    for (const st of [...u.statuses]) {
      if (st.def.dot && st.nextPulse <= s.t && st.nextPulse <= st.expiresAt) {
        st.nextPulse += st.def.dot.every;
        const hpAfter = loseHp(u, st.def.dot.damage);
        emit(s, { t: s.t, kind: "dot", uid: u.uid, status: st.def.id, damage: st.def.dot.damage, hpAfter });
        afterDamage(s, u, st.sourceUid);
        if (!u.alive) break;
      }
      if (st.expiresAt <= s.t) removeStatus(s, u, st.def.id);
    }
  }
}

/** Earliest future tick at which some status expires or pulses. */
export function nextStatusTime(s: BattleState): number {
  let best = Infinity;
  for (const u of s.units) {
    if (!u.alive) continue;
    for (const st of u.statuses) best = Math.min(best, st.expiresAt, st.nextPulse);
  }
  return best;
}

export function isFrozen(u: Unit): boolean {
  return u.statuses.some((st) => st.def.freezesGauge);
}
