import type { ClassDef } from "../sim/types.js";

export const classes = {
  knight: {
    id: "knight",
    name: "Knight",
    armour: { material: "plate", value: 6 },
    moveCost: 40,
    baseBonus: { hp: 4, defense: 2, speed: -1 },
    weaponTypes: ["sword", "lance"],
  },
  duelist: {
    id: "duelist",
    name: "Duelist",
    armour: { material: "leather", value: 2 },
    moveCost: 25,
    baseBonus: { skill: 2, agility: 2 },
    weaponTypes: ["sword"],
  },
  archer: {
    id: "archer",
    name: "Archer",
    armour: { material: "leather", value: 2 },
    moveCost: 30,
    baseBonus: { skill: 2 },
    weaponTypes: ["bow"],
  },
  brute: {
    id: "brute",
    name: "Brute",
    armour: { material: "chain", value: 4 },
    moveCost: 35,
    baseBonus: { hp: 4, strength: 2 },
    weaponTypes: ["mace", "axe"],
  },
} satisfies Record<string, ClassDef>;
