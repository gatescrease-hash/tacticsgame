import { idiv } from "./math.js";
import { hasStatus, stat } from "./stats.js";
import type { ComponentResult } from "./log.js";
import type { ArmourMaterial, DamageType, Element, PacketComponent, Pillar, Power, Tier, Unit } from "./types.js";

/**
 * Damage packets: every hit is a set of components, each resolved separately
 * against the target's defences: (power - mitigation) x tier.
 */

const MATERIAL_TIERS: Record<"slashing" | "piercing" | "bludgeoning" | "fire" | "lightning", Record<ArmourMaterial, Tier>> = {
  slashing: { cloth: 3, leather: 2, chain: 2, plate: 1, stone: 1 },
  piercing: { cloth: 2, leather: 3, chain: 3, plate: 2, stone: 1 },
  bludgeoning: { cloth: 2, leather: 2, chain: 2, plate: 3, stone: 3 },
  // Energy interacts with materials: fire burns soft armour, lightning punishes metal.
  fire: { cloth: 3, leather: 3, chain: 2, plate: 2, stone: 1 },
  lightning: { cloth: 2, leather: 2, chain: 3, plate: 3, stone: 1 },
};

export function pillarOf(type: DamageType): Pillar {
  switch (type) {
    case "slashing":
    case "piercing":
    case "bludgeoning":
      return "force";
    case "fire":
    case "lightning":
    case "light":
      return "energy";
    case "psychic":
      return "mind";
    case "spirit":
      return "spirit";
  }
}

export interface TierResult {
  tier: Tier;
  interaction?: string;
}

/** Each pillar reads a different part of the creature profile. */
export function tierFor(type: DamageType, element: Element | undefined, def: Unit): TierResult {
  let tier: Tier;
  const profile = def.race.profile;
  switch (type) {
    case "slashing":
    case "piercing":
    case "bludgeoning":
    case "fire":
    case "lightning":
      tier = MATERIAL_TIERS[type][def.cls.armour.material];
      break;
    case "light":
      tier = 2;
      break;
    case "psychic":
      tier = profile.mind ? 2 : 0;
      break;
    case "spirit":
      tier = profile.essence === "none" ? 0 : profile.essence === "high" ? 3 : 2;
      break;
  }
  const byType = def.race.resist?.[type];
  if (byType !== undefined) tier = byType;
  const byElement = element ? def.race.resist?.[element] : undefined;
  if (byElement !== undefined) tier = byElement;

  // Cross-element interactions.
  if (type === "lightning" && hasStatus(def, "wet") && tier > 0) {
    return { tier: 3, interaction: "conducted" };
  }
  return { tier };
}

export function mitigation(def: Unit, pillar: Pillar): number {
  switch (pillar) {
    case "force":
      return stat(def, "defense") + stat(def, "armour");
    case "energy":
      return stat(def, "arcana");
    case "mind":
      return stat(def, "mind");
    case "spirit":
      return stat(def, "spirit");
  }
}

export function powerOf(att: Unit, p: Power): number {
  let v = 0;
  if (p.weapon) v += stat(att, "strength") + att.weapon.might;
  if (p.stat) v += stat(att, p.stat);
  return idiv(v * (p.scale ?? 100), 100) + p.base;
}

export interface PacketResult {
  components: ComponentResult[];
  total: number;
  interaction?: string;
}

/**
 * Crits find a gap: x1.5 power and half the target's mitigation.
 * `spread` is a percent roll (100 = none) from rules.damageSpread; the
 * attacker's damageDealt and defender's damageTaken multiply the result.
 */
export function computePacket(att: Unit, def: Unit, packet: PacketComponent[], power: Power, crit: boolean, spread = 100): PacketResult {
  let pw = powerOf(att, power);
  if (crit) pw = idiv(pw * 3, 2);
  const mult = idiv(stat(att, "damageDealt") * stat(def, "damageTaken") * spread, 10_000);
  const components: ComponentResult[] = [];
  let total = 0;
  let interaction: string | undefined;
  for (const c of packet) {
    let mit = mitigation(def, pillarOf(c.type));
    if (crit) mit = idiv(mit, 2);
    const p = idiv(pw * c.share, 100);
    const m = idiv(mit * c.share, 100);
    const tr = tierFor(c.type, c.element, def);
    if (tr.interaction) interaction = tr.interaction;
    // Two-step rounding keeps (power - mitigation) x tier exact at mult 100.
    const damage = idiv(idiv(Math.max(0, p - m) * tr.tier, 2) * mult, 100);
    total += damage;
    components.push(c.element ? { type: c.type, element: c.element, tier: tr.tier, damage } : { type: c.type, tier: tr.tier, damage });
  }
  return interaction ? { components, total, interaction } : { components, total };
}
