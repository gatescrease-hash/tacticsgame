import { describe, expect, it } from "vitest";
import { content } from "../src/content/index.js";
import { basicAttack, Grid, hasLineOfSight, runBattle, setupBattle, type Content, type ScenarioDef } from "../src/sim/index.js";
import { executeAbility, inRangeFrom } from "../src/sim/combat.js";
import { edgeCost } from "../src/sim/movement.js";

/** A small test map: a 2 m ledge at x=3..4, a pit at (2,3). */
const scenario: ScenarioDef = {
  id: "ledge",
  name: "ledge",
  description: "",
  scouting: "",
  map: [
    ".....",
    ".....",
    ".....",
    "..O..",
    ".....",
  ],
  heights: [
    "00022",
    "00122",
    "00022",
    "00022",
    "00000",
  ],
  deployZone: { x0: 0, y0: 0, x1: 1, y1: 4 },
  units: [
    { unitId: "aldric", side: "player", pos: { x: 2, y: 0 } },
    { unitId: "kesh", side: "player", pos: { x: 1, y: 3 } },
    { unitId: "wren", side: "enemy", pos: { x: 3, y: 0 } },
    { unitId: "arago_spear_a", side: "enemy", pos: { x: 4, y: 4 } },
  ],
  doctrine: { kind: "advance" },
};
const world: Content = { ...content, scenarios: { ...content.scenarios, ledge: scenario } };
const setup = () => setupBattle(world, "ledge", 1, { rules: { formation: false } });

describe("elevation", () => {
  it("melee can't reach up a 2 m cliff, but reach weapons and bows can", () => {
    const s = setup();
    const [aldric, , wren, spear] = s.units as [any, any, any, any];
    void wren;
    // Aldric at (2,0) height 0, Wren on the ledge at (3,0) height 2: adjacent but 2 m apart.
    expect(inRangeFrom(s, aldric, basicAttack(aldric), aldric.pos, wren)).toBe(false);
    // A spear (reach 2) on the same footing could.
    spear.pos = { x: 2, y: 0 };
    aldric.pos = { x: 0, y: 0 };
    expect(inRangeFrom(s, spear, basicAttack(spear), spear.pos, wren)).toBe(true);
  });

  it("archers 2 m up shoot one tile further", () => {
    const range: ScenarioDef = {
      ...scenario,
      id: "range",
      map: ["........."],
      heights: ["200000000"],
      deployZone: { x0: 0, y0: 0, x1: 8, y1: 0 },
      units: [
        { unitId: "wren", side: "player", pos: { x: 0, y: 0 } },
        { unitId: "aldric", side: "enemy", pos: { x: 5, y: 0 } },
      ],
    };
    const w2: Content = { ...content, scenarios: { ...content.scenarios, range } };
    const s = setupBattle(w2, "range", 1, { rules: { formation: false } });
    const [wren, aldric] = s.units as [any, any];
    const bow = basicAttack(wren);
    expect(bow.range.max).toBe(4);
    expect(inRangeFrom(s, wren, bow, wren.pos, aldric)).toBe(true);
    wren.pos = { x: 1, y: 0 }; // off the high ground: distance 4 is fine, but 5 wouldn't be
    aldric.pos = { x: 6, y: 0 };
    expect(inRangeFrom(s, wren, bow, wren.pos, aldric)).toBe(false);
  });

  it("1 m steps are climbable, 2 m cliffs only by jumpers, drops are fine", () => {
    const s = setup();
    const [aldric, kesh] = s.units as [any, any];
    expect(edgeCost(aldric, s.grid, { x: 1, y: 1 }, { x: 2, y: 1 })).toBeGreaterThan(edgeCost(aldric, s.grid, { x: 0, y: 1 }, { x: 1, y: 1 }));
    expect(edgeCost(aldric, s.grid, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(-1);
    expect(edgeCost(kesh, s.grid, { x: 2, y: 0 }, { x: 3, y: 0 })).toBeGreaterThan(0);
    expect(edgeCost(aldric, s.grid, { x: 3, y: 0 }, { x: 2, y: 0 })).toBeGreaterThan(0);
  });

  it("pits stop walkers; jumpers leap them; they don't block sight", () => {
    const s = setup();
    const [aldric, kesh] = s.units as [any, any];
    expect(edgeCost(aldric, s.grid, { x: 1, y: 3 }, { x: 2, y: 3 })).toBe(-1);
    expect(edgeCost(aldric, s.grid, { x: 1, y: 3 }, { x: 3, y: 3 })).toBe(-1);
    expect(edgeCost(kesh, s.grid, { x: 1, y: 3 }, { x: 3, y: 3 })).toBeGreaterThan(0); // leap and climb 2 m: a jumper can
    expect(edgeCost(kesh, s.grid, { x: 2, y: 2 }, { x: 2, y: 4 })).toBeGreaterThan(0);
    expect(hasLineOfSight(s.grid, { x: 0, y: 3 }, { x: 4, y: 3 })).toBe(true);
  });

  it("high ground blocks sight between two low tiles", () => {
    const s = setup();
    expect(hasLineOfSight(s.grid, { x: 2, y: 2 }, { x: 2, y: 4 })).toBe(true);
    // From (1,0) to (1,4)... a ledge 2 m above both ends in between blocks.
    const grid = new (s.grid.constructor as any)(["....."], ["02200"]);
    expect(hasLineOfSight(grid, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(hasLineOfSight(grid, { x: 1, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it("being pushed into a pit knocks you out", () => {
    const s = setup();
    const kesh = s.units[1]!;
    // A gale from the west at (0,3) pushes Kesh (1,3) east into the pit at (2,3).
    const caster = s.units[0]!;
    caster.pos = { x: 0, y: 3 };
    caster.side = "enemy";
    const gale = world.abilities.gale!;
    executeAbility(s, caster, gale, kesh);
    if (kesh.alive) {
      // Gale may glance off; push is only applied when damage lands. Force a push via a crushing blow.
      executeAbility(s, caster, world.abilities.crushing_blow!, kesh);
    }
    const fell = s.log.some((e) => e.kind === "dot" && e.status === "fall");
    expect(fell).toBe(true);
    expect(kesh.alive).toBe(false);
  });

  it("flyers ignore cliffs and pits, swoop on any height, and can't be knocked into a pit", () => {
    const flyers: ScenarioDef = {
      ...scenario,
      id: "flyers",
      units: [
        { unitId: "aeris", side: "player", pos: { x: 2, y: 0 } },
        { unitId: "wren", side: "enemy", pos: { x: 3, y: 0 } },
      ],
    };
    const w2: Content = { ...content, scenarios: { ...content.scenarios, flyers } };
    const s = setupBattle(w2, "flyers", 1, { rules: { formation: false } });
    const [aeris, wren] = s.units as [any, any];
    expect(edgeCost(aeris, s.grid, { x: 2, y: 0 }, { x: 3, y: 0 })).toBeGreaterThan(0); // up a 2 m cliff
    expect(edgeCost(aeris, s.grid, { x: 2, y: 2 }, { x: 2, y: 3 })).toBeGreaterThan(0); // into a pit
    expect(inRangeFrom(s, aeris, basicAttack(aeris), aeris.pos, wren)).toBe(true);
    // Pushed from the west towards the pit at (2,3): a flyer just drifts over it.
    aeris.pos = { x: 1, y: 3 };
    wren.pos = { x: 0, y: 3 };
    executeAbility(s, wren, world.abilities.crushing_blow!, aeris);
    expect(s.log.some((e) => e.kind === "dot" && e.status === "fall")).toBe(false);
    expect(aeris.alive).toBe(true);
  });

  it("the cliffs scenario plays out deterministically", () => {
    const a = runBattle(content, "cliffs", 3);
    const b = runBattle(content, "cliffs", 3);
    expect(a.log).toEqual(b.log);
    expect(a.log.at(-1)?.kind).toBe("end");
  });
});

describe("walls and sight", () => {
  it("walls block sight at ground level, but not from battlements above them", () => {
    // A wall (3 m above its ground) between two ground tiles; a 3 m battlement behind it.
    const g = new Grid([".#.", "...", "..."], ["303", "000", "000"]);
    // Ground to ground across the wall: blocked.
    expect(hasLineOfSight(new Grid(["...", ".#.", "..."]), { x: 1, y: 0 }, { x: 1, y: 2 })).toBe(false);
    // From the 3 m battlement (2,0) over the wall (1,0) to the field (0,0)... the wall's own top is 3 m.
    expect(hasLineOfSight(g, { x: 2, y: 0 }, { x: 0, y: 0 })).toBe(true);
  });
});
