import { describe, expect, it } from "vitest";
import { content } from "../src/content/index.js";
import {
  applyResult,
  chooseOffer,
  currentEncounter,
  defaultDeployment,
  fight,
  newRun,
  unitMods,
  xpToNext,
  type BattleRecord,
} from "../src/run/run.js";

const FAST = { samples: 4 };

describe("run loop", () => {
  it("starts deterministically with a roster and an encounter", () => {
    const a = newRun(7, FAST);
    const b = newRun(7, FAST);
    expect(a.order).toEqual(b.order);
    expect(a.roster.map((r) => r.unitId)).toEqual(["aldric", "wren", "oswin", "kesh", "sela"]);
    const enc = currentEncounter(content, a);
    expect(enc.enemyPower).toBe(0);
    expect(enc.slots).toBeGreaterThan(0);
  });

  it("fights, levels units, offers rewards and moves on", () => {
    const run = newRun(3, FAST);
    const enc = currentEncounter(content, run);
    const deployed = defaultDeployment(run, enc.slots);
    const { record } = fight(content, run, deployed);
    expect(record.deployed).toEqual(deployed);
    applyResult(content, run, record);
    const fought = run.roster.filter((r) => deployed.includes(r.unitId));
    expect(fought.every((r) => r.battles === 1)).toBe(true);
    expect(run.offers?.length).toBe(record.won ? 3 : 2);
    chooseOffer(run, 0);
    expect(run.battle).toBe(1);
    expect(currentEncounter(content, run).enemyPower).toBe(run.config.ramp);
  });

  it("losses cost hearts and end the run at zero", () => {
    const run = newRun(1, FAST);
    const loss = (lost: number): BattleRecord => ({
      battle: run.battle, scenario: "patrol", enemyPower: 0, deployed: ["aldric"], won: false, winProb: 0, heartsLost: lost, knockedOut: ["aldric"],
    });
    applyResult(content, run, loss(3));
    expect(run.hearts).toBe(2);
    expect(run.roster.find((r) => r.unitId === "aldric")!.fatigued).toBe(true);
    expect(unitMods(content, run.roster[0]!)).toContainEqual({ key: "damageDealt", op: "pct", value: -10 });
    chooseOffer(run, 0);
    applyResult(content, run, loss(3));
    expect(run.over).toBe(true);
    expect(run.offers).toBeNull();
  });

  it("levels slow down as units grow", () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(5)).toBeGreaterThan(xpToNext(2));
  });

  it("rewards apply", () => {
    const run = newRun(2, FAST);
    run.offers = [
      { kind: "recruit", unitId: "vex", label: "" },
      { kind: "train", unitId: "wren", stat: "skill", amount: 2, label: "" },
    ];
    chooseOffer(run, 0);
    expect(run.roster.some((r) => r.unitId === "vex")).toBe(true);
    run.offers = [{ kind: "train", unitId: "wren", stat: "skill", amount: 2, label: "" }];
    chooseOffer(run, 0);
    expect(run.roster.find((r) => r.unitId === "wren")!.training.skill).toBe(2);
  });
});
