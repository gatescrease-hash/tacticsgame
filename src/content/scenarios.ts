import type { ScenarioDef } from "../sim/types.js";

/** Fixed, hand-authored test scenarios. Map generation comes much later. */
export const scenarios = {
  duel: {
    id: "duel",
    name: "Duel: knight vs duelist",
    map: [
      "........",
      "...#....",
      "........",
      "....#...",
      "........",
    ],
    units: [
      { unitId: "aldric", side: "player", pos: { x: 0, y: 2 } },
      { unitId: "vex", side: "enemy", pos: { x: 7, y: 2 } },
    ],
  },
  skirmish: {
    id: "skirmish",
    name: "Skirmish: 2v2 across the marsh",
    map: [
      "..........",
      "..#....#..",
      "...~~~~...",
      "...~~~~...",
      "..#....#..",
      "..........",
    ],
    units: [
      { unitId: "aldric", side: "player", pos: { x: 1, y: 2 } },
      { unitId: "wren", side: "player", pos: { x: 0, y: 3 } },
      { unitId: "vex", side: "enemy", pos: { x: 8, y: 2 } },
      { unitId: "gorm", side: "enemy", pos: { x: 9, y: 3 } },
    ],
  },
} satisfies Record<string, ScenarioDef>;
