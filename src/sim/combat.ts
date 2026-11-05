import { clamp, idiv } from "./math.js";
import type { Rng } from "./rng.js";
import type { ArmourMaterial, DamageType, Unit } from "./types.js";
import type { AttackOutcome } from "./log.js";

/**
 * Damage-type vs armour-material tiers, stored as x2 integers:
 * 0 immune, 1 resist (x0.5), 2 normal (x1), 3 weak (x1.5).
 * (Design notes table: slashing strong vs cloth, weak vs plate/stone, etc.)
 */
const TIER_X2: Record<string, Partial<Record<ArmourMaterial, number>>> = {
  slashing: { cloth: 3, leather: 2, chain: 2, plate: 1, stone: 1 },
  piercing: { cloth: 2, leather: 3, chain: 3, plate: 2, stone: 1 },
  bludgeoning: { cloth: 2, leather: 2, chain: 2, plate: 3, stone: 3 },
};

export function tierX2(type: DamageType, material: ArmourMaterial): number {
  return TIER_X2[type]?.[material] ?? 2;
}

export interface AttackResult {
  outcome: AttackOutcome;
  crit: boolean;
  damage: number;
}

export function hitChance(att: Unit): number {
  return clamp(60 + 2 * att.stats.skill + att.weapon.accuracy, 5, 99);
}

export function dodgeChance(att: Unit, def: Unit): number {
  return clamp(2 * def.stats.agility - att.stats.skill, 0, 60);
}

export function parryChance(att: Unit, def: Unit, distance: number): number {
  if (distance > 1 || !def.weapon.canParry || att.weapon.ignoresParry) return 0;
  return clamp(def.stats.skill + def.stats.agility - att.stats.skill, 0, 50);
}

export function critChance(att: Unit, def: Unit): number {
  return clamp(idiv(att.stats.skill, 2) + idiv(att.stats.luck - def.stats.luck, 4), 0, 50);
}

/**
 * Raw damage of one hit, before any rolls. Crits find a gap: x1.5 power and
 * half the target's mitigation.
 */
export function packetDamage(att: Unit, def: Unit, crit: boolean): number {
  let power = att.stats.strength + att.weapon.might;
  let mitigation = def.stats.defense + def.cls.armour.value;
  if (crit) {
    power = idiv(power * 3, 2);
    mitigation = idiv(mitigation, 2);
  }
  let total = 0;
  for (const c of att.weapon.packet) {
    const p = idiv(power * c.share, 100);
    const m = idiv(mitigation * c.share, 100);
    total += idiv(Math.max(0, p - m) * tierX2(c.type, def.cls.armour.material), 2);
  }
  return total;
}

/**
 * Staged resolution: aim -> reaction -> armour -> effect. Each stage that stops
 * the attack produces a named outcome for the log and speech bubbles.
 */
export function resolveAttack(rng: Rng, att: Unit, def: Unit, distance: number): AttackResult {
  // Aim
  if (!rng.chance(hitChance(att))) return { outcome: "missed", crit: false, damage: 0 };
  // Reaction
  if (rng.chance(dodgeChance(att, def))) return { outcome: "dodged", crit: false, damage: 0 };
  if (rng.chance(parryChance(att, def, distance))) return { outcome: "parried", crit: false, damage: 0 };
  // Armour
  const crit = rng.chance(critChance(att, def));
  const damage = packetDamage(att, def, crit);
  if (damage <= 0) return { outcome: "glanced off", crit, damage: 0 };
  // Effect (statuses come later)
  return { outcome: "hit", crit, damage };
}
