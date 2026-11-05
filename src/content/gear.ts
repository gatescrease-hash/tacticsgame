import type { TrinketDef, WeaponDef } from "../sim/types.js";

/** Weapons are pipeline tools: swords parry, daggers ignore parries, maces beat armour, spears reach. */
export const weapons = {
  longsword: {
    id: "longsword", name: "Longsword", type: "sword",
    packet: [{ type: "slashing", share: 100 }],
    might: 7, accuracy: 0, cost: 100, range: { min: 1, max: 1 }, canParry: true, ignoresParry: false,
  },
  emberblade: {
    // A hybrid trades peak for reliability: never fully countered, never fully exploits a weakness.
    id: "emberblade", name: "Emberblade", type: "sword",
    packet: [{ type: "slashing", share: 70 }, { type: "fire", share: 30 }],
    might: 7, accuracy: 0, cost: 100, range: { min: 1, max: 1 }, canParry: true, ignoresParry: false,
  },
  estoc: {
    id: "estoc", name: "Estoc", type: "sword",
    packet: [{ type: "piercing", share: 100 }],
    might: 8, accuracy: 5, cost: 60, range: { min: 1, max: 1 }, canParry: true, ignoresParry: false,
  },
  venom_dagger: {
    id: "venom_dagger", name: "Venom dagger", type: "dagger",
    packet: [{ type: "piercing", share: 100 }],
    might: 4, accuracy: 10, cost: 50, range: { min: 1, max: 1 }, canParry: false, ignoresParry: true,
    passives: ["poison_blade"],
  },
  shortbow: {
    id: "shortbow", name: "Shortbow", type: "bow",
    packet: [{ type: "piercing", share: 100 }],
    might: 6, accuracy: 0, cost: 80, range: { min: 2, max: 4 }, canParry: false, ignoresParry: true,
  },
  crossbow: {
    id: "crossbow", name: "Crossbow", type: "crossbow",
    packet: [{ type: "piercing", share: 100 }],
    might: 9, accuracy: 5, cost: 120, range: { min: 2, max: 5 }, canParry: false, ignoresParry: true,
  },
  staff: {
    id: "staff", name: "Staff", type: "staff",
    packet: [{ type: "bludgeoning", share: 100 }],
    might: 2, accuracy: 0, cost: 100, range: { min: 1, max: 1 }, canParry: true, ignoresParry: false,
  },
  mace: {
    id: "mace", name: "Mace", type: "mace",
    packet: [{ type: "bludgeoning", share: 100 }],
    might: 7, accuracy: -5, cost: 110, range: { min: 1, max: 1 }, canParry: false, ignoresParry: false,
  },
  spear: {
    id: "spear", name: "Spear", type: "spear",
    packet: [{ type: "piercing", share: 100 }],
    might: 6, accuracy: 10, cost: 100, range: { min: 1, max: 2 }, canParry: false, ignoresParry: false,
  },
  stone_fists: {
    id: "stone_fists", name: "Stone fists", type: "fist",
    packet: [{ type: "bludgeoning", share: 100 }],
    might: 9, accuracy: -5, cost: 130, range: { min: 1, max: 1 }, canParry: false, ignoresParry: false,
  },
  piston: {
    id: "piston", name: "Piston arm", type: "fist",
    packet: [{ type: "bludgeoning", share: 100 }],
    might: 7, accuracy: 0, cost: 110, range: { min: 1, max: 1 }, canParry: false, ignoresParry: false,
  },
  fangs: {
    id: "fangs", name: "Fangs", type: "fang",
    packet: [{ type: "piercing", share: 100 }],
    might: 4, accuracy: 5, cost: 70, range: { min: 1, max: 1 }, canParry: false, ignoresParry: true,
  },
  mud_slam: {
    id: "mud_slam", name: "Mud slam", type: "fist",
    packet: [{ type: "bludgeoning", share: 100 }],
    might: 5, accuracy: 0, cost: 110, range: { min: 1, max: 1 }, canParry: false, ignoresParry: false,
  },
} satisfies Record<string, WeaponDef>;

/** One or two trinkets per unit. Gear is about this battle; abilities are who the unit is. */
export const trinkets = {
  lucky_charm: { id: "lucky_charm", name: "Lucky charm", mods: [{ key: "luck", op: "flat", value: 3 }] },
  ring_of_haste: { id: "ring_of_haste", name: "Ring of haste", mods: [{ key: "fillRate", op: "flat", value: 1 }] },
  warding_amulet: {
    id: "warding_amulet", name: "Warding amulet",
    mods: [{ key: "arcana", op: "flat", value: 2 }, { key: "spirit", op: "flat", value: 2 }],
  },
  whetstone: { id: "whetstone", name: "Whetstone", mods: [{ key: "crit", op: "flat", value: 5 }] },
  iron_band: { id: "iron_band", name: "Iron band", mods: [{ key: "defense", op: "flat", value: 1 }] },
} satisfies Record<string, TrinketDef>;
