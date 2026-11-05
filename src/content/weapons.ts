import type { WeaponDef } from "../sim/types.js";

/** Weapons are pipeline tools: swords parry, maces beat armour, bows keep distance. */
export const weapons = {
  longsword: {
    id: "longsword",
    name: "Longsword",
    packet: [{ type: "slashing", share: 100 }],
    might: 7,
    accuracy: 0,
    cost: 100,
    range: { min: 1, max: 1 },
    canParry: true,
    ignoresParry: false,
  },
  estoc: {
    id: "estoc",
    name: "Estoc",
    packet: [{ type: "piercing", share: 100 }],
    might: 9,
    accuracy: 5,
    cost: 60,
    range: { min: 1, max: 1 },
    canParry: true,
    ignoresParry: false,
  },
  shortbow: {
    id: "shortbow",
    name: "Shortbow",
    packet: [{ type: "piercing", share: 100 }],
    might: 6,
    accuracy: 0,
    cost: 80,
    range: { min: 2, max: 4 },
    canParry: false,
    ignoresParry: true,
  },
  mace: {
    id: "mace",
    name: "Mace",
    packet: [{ type: "bludgeoning", share: 100 }],
    might: 8,
    accuracy: -5,
    cost: 110,
    range: { min: 1, max: 1 },
    canParry: false,
    ignoresParry: false,
  },
} satisfies Record<string, WeaponDef>;
