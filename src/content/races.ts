import type { RaceDef } from "../sim/types.js";

/** Races are a lens over the shared class tree: passives and predispositions, not separate trees. */
export const races = {
  human: {
    id: "human",
    name: "Human",
    profile: { mind: true, essence: "some", tags: ["flesh"] },
    statBonus: {},
    passives: [],
  },
  lizardfolk: {
    id: "lizardfolk",
    name: "Lizardfolk",
    profile: { mind: true, essence: "some", tags: ["flesh", "scaled"] },
    statBonus: { defense: 1, agility: 1, mind: -1 },
    passives: [],
    moveTags: ["swampwalker"],
  },
  wolf: {
    id: "wolf",
    name: "Wolf",
    profile: { mind: true, essence: "some", tags: ["flesh", "beast"] },
    statBonus: { speed: 2 },
    passives: [],
    lockedClasses: ["knight", "pyromancer", "cleric"],
  },
  golem: {
    id: "golem",
    name: "Golem",
    // Immune to psychic (no mind); spirit magic unravels it (high essence).
    profile: { mind: false, essence: "high", tags: ["construct", "stone"] },
    statBonus: { hp: 10, defense: 2 },
    resist: { fire: 0 },
    passives: [],
  },
  steamwork: {
    id: "steamwork",
    name: "Steamwork",
    // Only force and energy work: a hard counter to mage-heavy teams.
    profile: { mind: false, essence: "none", tags: ["construct", "metal"] },
    statBonus: { defense: 1 },
    passives: [],
  },
  mudling: {
    id: "mudling",
    name: "Mudling",
    profile: { mind: false, essence: "some", tags: ["mud"] },
    statBonus: {},
    // Water dissolves mud creatures; blades sink in and do little.
    resist: { water: 3, piercing: 1, slashing: 1 },
    passives: [],
    moveTags: ["swampwalker"],
  },
} satisfies Record<string, RaceDef>;
