import { decide } from "./ai.js";
import { advance, nextActor, openingGauge, ticksToNextReady } from "./clock.js";
import { resolveAttack } from "./combat.js";
import { Grid, manhattan } from "./grid.js";
import type { BattleLog, UnitSnapshot } from "./log.js";
import { Rng } from "./rng.js";
import type { Content, Side, Stats, Unit } from "./types.js";

export interface BattleState {
  scenarioId: string;
  seed: number;
  grid: Grid;
  units: Unit[];
  rng: Rng;
  /** Current tick. */
  t: number;
  log: BattleLog;
}

export interface BattleResult {
  winner: Side | "draw";
  ticks: number;
  log: BattleLog;
  /** Final unit state, handy for batch stats. */
  units: Unit[];
}

export interface BattleOptions {
  /** Safety valve: declare a draw after this many ticks. */
  maxTicks?: number;
}

const WAIT_COST = 50;

export function setupBattle(content: Content, scenarioId: string, seed: number): BattleState {
  const scenario = content.scenarios[scenarioId];
  if (!scenario) throw new Error(`unknown scenario '${scenarioId}'`);
  const grid = new Grid(scenario.map);

  const units: Unit[] = scenario.units.map((su, uid) => {
    const def = content.units[su.unitId];
    if (!def) throw new Error(`scenario '${scenarioId}': unknown unit '${su.unitId}'`);
    const cls = content.classes[def.classId];
    if (!cls) throw new Error(`unit '${def.id}': unknown class '${def.classId}'`);
    const weapon = content.weapons[def.weaponId];
    if (!weapon) throw new Error(`unit '${def.id}': unknown weapon '${def.weaponId}'`);
    const stats = { ...def.stats };
    for (const [k, v] of Object.entries(cls.baseBonus)) stats[k as keyof Stats] += v ?? 0;
    return {
      uid,
      defId: def.id,
      name: def.name,
      side: su.side,
      cls,
      weapon,
      stats,
      traits: [...def.traits],
      pos: { ...su.pos },
      hp: stats.hp,
      gauge: 0,
      alive: true,
    };
  });
  for (const u of units) u.gauge = openingGauge(u);

  return { scenarioId, seed, grid, units, rng: new Rng(seed), t: 0, log: [] };
}

export function snapshot(u: Unit): UnitSnapshot {
  return { uid: u.uid, name: u.name, className: u.cls.name, side: u.side, pos: { ...u.pos }, hp: u.hp, maxHp: u.stats.hp };
}

/** Simulate a whole battle headlessly ("baked, not computed live"). */
export function runBattle(content: Content, scenarioId: string, seed: number, opts: BattleOptions = {}): BattleResult {
  const maxTicks = opts.maxTicks ?? 20_000;
  const s = setupBattle(content, scenarioId, seed);
  const scenario = content.scenarios[scenarioId]!;
  s.log.push({
    t: 0,
    kind: "start",
    scenario: scenarioId,
    seed,
    width: s.grid.width,
    height: s.grid.height,
    map: [...scenario.map],
    units: s.units.map(snapshot),
  });

  let winner: Side | "draw";
  for (;;) {
    const playerAlive = s.units.some((u) => u.alive && u.side === "player");
    const enemyAlive = s.units.some((u) => u.alive && u.side === "enemy");
    if (!playerAlive || !enemyAlive) {
      winner = playerAlive ? "player" : enemyAlive ? "enemy" : "draw";
      s.log.push({ t: s.t, kind: "end", winner, reason: "defeat all enemies" });
      break;
    }
    if (s.t > maxTicks) {
      winner = "draw";
      s.log.push({ t: s.t, kind: "end", winner, reason: `timeout after ${maxTicks} ticks` });
      break;
    }

    const actor = nextActor(s.units);
    if (!actor) {
      const dt = ticksToNextReady(s.units);
      advance(s.units, dt);
      s.t += dt;
      continue;
    }
    act(s, actor);
  }

  return { winner, ticks: s.t, log: s.log, units: s.units };
}

function act(s: BattleState, u: Unit): void {
  const action = decide(s, u);
  switch (action.kind) {
    case "attack": {
      const target = action.target;
      const res = resolveAttack(s.rng, u, target, manhattan(u.pos, target.pos));
      target.hp = Math.max(0, target.hp - res.damage);
      const cost = u.weapon.cost;
      u.gauge -= cost;
      s.log.push({ t: s.t, kind: "attack", uid: u.uid, target: target.uid, ...res, hpAfter: target.hp, cost });
      if (target.hp === 0) {
        target.alive = false;
        s.log.push({ t: s.t, kind: "knockout", uid: target.uid, by: u.uid });
      }
      return;
    }
    case "move": {
      const cost = u.cls.moveCost * s.grid.tile(action.to).moveMult;
      const from = { ...u.pos };
      u.pos = { ...action.to };
      u.gauge -= cost;
      s.log.push({ t: s.t, kind: "move", uid: u.uid, from, to: { ...action.to }, cost });
      return;
    }
    case "wait": {
      u.gauge -= WAIT_COST;
      s.log.push({ t: s.t, kind: "wait", uid: u.uid, cost: WAIT_COST });
      return;
    }
  }
}
