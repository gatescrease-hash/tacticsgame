import { describe, expect, it } from "vitest";
import { content } from "../src/content/index.js";
import { createUnit, setupBattle, stat, computePacket, validateContent, type Content } from "../src/sim/index.js";
import { applyStatus, addBuildup } from "../src/sim/statuses.js";
import { executeAbility, basicAttack } from "../src/sim/combat.js";

function unit(id: string, side: "player" | "enemy" = "player", uid = 0) {
  return createUnit(content, id, side, uid);
}

describe("content", () => {
  it("validates cleanly", () => {
    expect(validateContent(content)).toEqual([]);
  });

  it("catches broken references", () => {
    const broken: Content = structuredClone({ ...content, units: { ...content.units } });
    broken.units.bad = { ...content.units.aldric!, id: "bad", classId: "nope", weaponId: "shortbow", traits: ["unknown"] };
    const errors = validateContent(broken);
    expect(errors.some((e) => e.includes("unknown class 'nope'"))).toBe(true);
    expect(errors.some((e) => e.includes("unknown trait 'unknown'"))).toBe(true);
  });
});

describe("modifier stack", () => {
  it("applies flat, then percent, then caps", () => {
    const u = unit("aldric");
    const base = stat(u, "strength");
    u.staticMods.push({ key: "strength", op: "pct", value: 50 }, { key: "strength", op: "flat", value: 2 });
    u.cache.clear();
    expect(stat(u, "strength")).toBe(Math.trunc(((base + 2) * 150) / 100));
    u.staticMods.push({ key: "strength", op: "cap", value: 5 });
    u.cache.clear();
    expect(stat(u, "strength")).toBe(5);
  });

  it("class and trinkets feed derived values", () => {
    const wren = unit("wren");
    // 60 + 2*skill + accuracy + keen eye 5
    expect(stat(wren, "hit")).toBe(60 + 2 * stat(wren, "skill") + 0 + 5);
    expect(stat(unit("aldric"), "block")).toBe(15);
  });
});

describe("damage packets", () => {
  it("golems shrug off fire and minds don't matter", () => {
    const sela = unit("sela");
    const golem = unit("golem", "enemy", 1);
    const fire = computePacket(sela, golem, [{ type: "fire", share: 100 }], { stat: "arcana", base: 4 }, false);
    expect(fire.components[0]!.tier).toBe(0);
    expect(fire.total).toBe(0);
    const psychic = computePacket(sela, golem, [{ type: "psychic", share: 100 }], { stat: "mind", base: 4 }, false);
    expect(psychic.total).toBe(0);
    const spirit = computePacket(sela, golem, [{ type: "spirit", share: 100 }], { stat: "spirit", base: 10 }, false);
    expect(spirit.components[0]!.tier).toBe(3);
  });

  it("hybrids split into components resolved separately", () => {
    const aldric = unit("aldric");
    const auto = unit("automaton_a", "enemy", 1);
    const r = computePacket(aldric, auto, aldric.weapon.packet, { weapon: true, base: 0 }, false);
    expect(r.components.map((c) => c.type)).toEqual(["slashing", "fire"]);
    expect(r.components[0]!.tier).toBe(1); // slashing vs plate: resisted
  });

  it("water dissolves mud", () => {
    const mira = unit("mira");
    const mud = unit("mudling_a", "enemy", 1);
    const r = computePacket(mira, mud, [{ type: "bludgeoning", element: "water", share: 100 }], { stat: "arcana", base: 3 }, false);
    expect(r.components[0]!.tier).toBe(3);
  });
});

describe("statuses and interactions", () => {
  const scene = () => setupBattle(content, "duel", 1);

  it("build-up triggers a status at the threshold", () => {
    const s = scene();
    const vex = s.units[1]!;
    addBuildup(s, vex, "burning", 40, 0);
    expect(vex.statuses).toHaveLength(0);
    for (let i = 0; i < 5; i++) addBuildup(s, vex, "burning", 40, 0);
    expect(vex.statuses.map((x) => x.def.id)).toContain("burning");
  });

  it("wet puts out burning, and lightning conducts through wet", () => {
    const s = scene();
    const vex = s.units[1]!;
    applyStatus(s, vex, "burning", 0);
    applyStatus(s, vex, "wet", 0);
    expect(vex.statuses.map((x) => x.def.id)).toEqual(["wet"]);
    const mira = createUnit(content, "mira", "player", 9);
    const r = computePacket(mira, vex, [{ type: "lightning", share: 100 }], { stat: "arcana", base: 4 }, false);
    expect(r.interaction).toBe("conducted");
    expect(r.components[0]!.tier).toBe(3);
  });

  it("riposte counters a melee attack", () => {
    const s = scene();
    const [aldric, vex] = [s.units[0]!, s.units[1]!];
    aldric.pos = { x: 3, y: 2 };
    vex.pos = { x: 4, y: 2 };
    executeAbility(s, aldric, basicAttack(aldric), vex);
    expect(s.log.some((e) => e.kind === "ability" && e.counter && e.uid === vex.uid)).toBe(true);
  });
});
