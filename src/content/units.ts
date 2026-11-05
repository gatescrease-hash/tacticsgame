import type { UnitDef } from "../sim/types.js";

/** Preset units at fixed levels stand in for progression (build step 1). */
export const units = {
  aldric: {
    id: "aldric",
    name: "Aldric",
    classId: "knight",
    weaponId: "longsword",
    stats: { hp: 26, strength: 9, skill: 5, speed: 7, agility: 2, defense: 2, arcana: 1, mind: 3, spirit: 3, resolve: 8, luck: 3 },
    traits: ["brave"],
  },
  vex: {
    id: "vex",
    name: "Vex",
    classId: "duelist",
    weaponId: "estoc",
    stats: { hp: 22, strength: 6, skill: 8, speed: 11, agility: 7, defense: 2, arcana: 2, mind: 5, spirit: 2, resolve: 4, luck: 6 },
    traits: ["reckless"],
  },
  wren: {
    id: "wren",
    name: "Wren",
    classId: "archer",
    weaponId: "shortbow",
    stats: { hp: 20, strength: 6, skill: 7, speed: 8, agility: 5, defense: 1, arcana: 2, mind: 4, spirit: 3, resolve: 3, luck: 5 },
    traits: ["cowardly"],
  },
  gorm: {
    id: "gorm",
    name: "Gorm",
    classId: "brute",
    weaponId: "mace",
    stats: { hp: 28, strength: 8, skill: 4, speed: 5, agility: 2, defense: 3, arcana: 0, mind: 2, spirit: 2, resolve: 6, luck: 2 },
    traits: ["dim"],
  },
} satisfies Record<string, UnitDef>;
