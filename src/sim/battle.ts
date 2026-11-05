import { debugCandidates, decide } from "./ai.js";
import { advance, nextActor, openingGauge, projectTurnOrder, ticksToNextEvent } from "./clock.js";
import { basicAttack, executeAbility, inRangeFrom } from "./combat.js";
import { firePassives, say } from "./effects.js";
import { arrangeFormation } from "./formation.js";
import { Grid, manhattan } from "./grid.js";
import { Rng } from "./rng.js";
import { DEFAULT_RULES, emit, type BattleOptions, type BattleState, type Rules } from "./state.js";
import { updateStatuses } from "./statuses.js";
import { maxHp, stepCostAt } from "./stats.js";
import type { BattleLog, UnitSnapshot } from "./log.js";
import type { AbilityDef, Content, Modifier, PassiveDef, Pos, Side, Stats, TraitDef, Unit, Weights } from "./types.js";

export type { BattleOptions, BattleState };

export interface BattleResult {
  winner: Side | "draw";
  ticks: number;
  log: BattleLog;
  /** Final unit state, handy for batch stats. */
  units: Unit[];
}

const WAIT_COST = 50;
/** Ticks the player's squad will hold before advancing anyway (rules.playerHold). */
const PLAYER_HOLD_LIMIT = 150;

export const DEFAULT_WEIGHTS: Weights = { damage: 10, kill: 8, danger: 3, support: 8, aoe: 8, tempo: 10, aggression: 10 };

function need<T>(table: Record<string, T>, id: string, what: string): T {
  const v = table[id];
  if (!v) throw new Error(`unknown ${what} '${id}'`);
  return v;
}

/** Build a runtime unit from content. Layers: personal + race -> class -> gear -> passives. */
export function createUnit(content: Content, unitId: string, side: Side, uid: number): Unit {
  const def = need(content.units, unitId, "unit");
  const race = need(content.races, def.raceId, "race");
  const cls = need(content.classes, def.classId, "class");
  const weapon = need(content.weapons, def.weaponId, "weapon");
  const trinkets = def.trinkets.map((id) => need(content.trinkets, id, "trinket"));
  const traits: TraitDef[] = def.traits.map((id) => need(content.traits, id, "trait"));

  const base: Stats = { ...def.stats };
  for (const [k, v] of Object.entries(race.statBonus)) base[k as keyof Stats] += v ?? 0;

  const passiveIds = [...race.passives, ...cls.passives, ...(weapon.passives ?? []), ...trinkets.flatMap((t) => t.passives ?? []), ...traits.flatMap((t) => t.passives ?? [])];
  const passives: PassiveDef[] = [...new Set(passiveIds)].map((id) => need(content.passives, id, "passive"));

  const staticMods: Modifier[] = [
    ...Object.entries(cls.baseBonus).map(([k, v]) => ({ key: k as keyof Stats, op: "flat" as const, value: v ?? 0 })),
    ...trinkets.flatMap((t) => t.mods),
    ...passives.flatMap((p) => p.mods ?? []),
  ];

  const weights: Weights = { ...DEFAULT_WEIGHTS };
  for (const t of traits) for (const [k, v] of Object.entries(t.weights)) weights[k as keyof Weights] += v ?? 0;
  for (const k of Object.keys(weights) as (keyof Weights)[]) weights[k] = Math.max(0, weights[k]);

  const u: Unit = {
    uid,
    defId: def.id,
    name: def.name,
    side,
    race,
    cls,
    weapon,
    abilities: [],
    passives,
    traits,
    weights,
    base,
    staticMods,
    situationalMods: [],
    statuses: [],
    buildup: {},
    cooldowns: {},
    firedOnce: new Set(),
    hpFlags: { below50: false, below25: false },
    pos: { x: 0, y: 0 },
    hp: 0,
    gauge: 0,
    alive: true,
    intent: "engage",
    lastReason: null,
    idle: 0,
    meters: {},
    cache: new Map(),
  };
  const abilities: AbilityDef[] = [basicAttack(u), ...cls.abilities.map((id) => need(content.abilities, id, "ability"))];
  u.abilities = abilities;
  u.hp = maxHp(u);
  return u;
}

export function setupBattle(content: Content, scenarioId: string, seed: number, opts: BattleOptions = {}): BattleState {
  const scenario = need(content.scenarios, scenarioId, "scenario");
  const grid = new Grid(scenario.map);
  const rules: Rules = { ...DEFAULT_RULES, ...opts.rules };
  const benched = new Set(opts.benched ?? []);
  const units: Unit[] = [];
  scenario.units.forEach((su, i) => {
    if (benched.has(i)) return;
    const u = createUnit(content, su.unitId, su.side, units.length);
    if (su.side === "enemy" && scenario.enemyMods) u.staticMods.push(...scenario.enemyMods);
    if (su.side === "enemy" && opts.enemyPower) {
      u.staticMods.push({ key: "hp", op: "pct", value: opts.enemyPower }, { key: "damageDealt", op: "pct", value: opts.enemyPower });
    }
    if (rules.hpScale !== 100) u.staticMods.push({ key: "hp", op: "pct", value: rules.hpScale - 100 });
    u.cache.clear();
    u.hp = maxHp(u);
    u.pos = { ...(opts.placements?.[i] ?? su.pos) };
    units.push(u);
  });

  if (rules.formation) {
    const enemies = units.filter((u) => u.side === "enemy");
    const z = scenario.deployZone;
    const tiles: Pos[] = [];
    for (let y = z.y0; y <= z.y1; y++) {
      for (let x = z.x0; x <= z.x1; x++) {
        const p = { x, y };
        if (grid.inBounds(p) && !grid.tile(p).blocked && !enemies.some((e) => e.pos.x === x && e.pos.y === y)) tiles.push(p);
      }
    }
    const toward = {
      x: Math.round(enemies.reduce((a, e) => a + e.pos.x, 0) / Math.max(1, enemies.length)),
      y: Math.round(enemies.reduce((a, e) => a + e.pos.y, 0) / Math.max(1, enemies.length)),
    };
    arrangeFormation(units.filter((u) => u.side === "player"), tiles, toward);
  }

  const playerHolds = rules.playerHold > 0 && scenario.doctrine.kind !== "hold";
  const jitterRng = new Rng((seed ^ 0x9e3779b9) >>> 0);
  for (const u of units) {
    u.gauge = openingGauge(u);
    if (opts.gaugeJitter) u.gauge = Math.min(99, u.gauge + jitterRng.int(opts.gaugeJitter + 1));
    if (opts.tempoOffset && u.side === "player") u.gauge = Math.min(99, u.gauge + opts.tempoOffset);
    if (u.side === "enemy" && scenario.doctrine.kind === "hold") u.intent = "hold";
    if (u.side === "player" && playerHolds) u.intent = "hold";
  }
  // Per-unit streams are seeded from (seed, uid) so a unit's luck doesn't depend on anyone else.
  const streams = units.map((u) => new Rng(Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(u.uid + 1, 0x85ebca77)));
  if (rules.luck === "meter") {
    // The seed only decides where each unit's luck meters start.
    const meterRng = new Rng((seed * 2654435761) ^ 0x5bd1e995);
    for (const u of units) for (const key of ["aim", "dodge", "parry", "block", "crit"]) u.meters[key] = rules.seededLuck ? meterRng.int(100) : 50;
  }
  return { content, scenario, seed, grid, units, rng: new Rng(seed), streams, rules, t: 0, log: [], opts };
}

export function snapshot(u: Unit): UnitSnapshot {
  return {
    uid: u.uid,
    name: u.name,
    className: u.cls.name,
    raceName: u.race.name,
    side: u.side,
    pos: { ...u.pos },
    hp: u.hp,
    maxHp: maxHp(u),
    traits: u.traits.map((t) => t.name),
  };
}

/** Simulate a whole battle headlessly ("baked, not computed live"). */
export function runBattle(content: Content, scenarioId: string, seed: number, opts: BattleOptions = {}): BattleResult {
  const maxTicks = opts.maxTicks ?? 5_000;
  const s = setupBattle(content, scenarioId, seed, opts);
  emit(s, {
    t: 0,
    kind: "start",
    scenario: scenarioId,
    seed,
    width: s.grid.width,
    height: s.grid.height,
    map: [...s.scenario.map],
    units: s.units.map(snapshot),
  });

  let winner: Side | "draw";
  for (;;) {
    const playerAlive = s.units.some((u) => u.alive && u.side === "player");
    const enemyAlive = s.units.some((u) => u.alive && u.side === "enemy");
    if (!playerAlive || !enemyAlive) {
      winner = playerAlive ? "player" : enemyAlive ? "enemy" : "draw";
      emit(s, { t: s.t, kind: "end", winner, reason: "defeat all enemies" });
      break;
    }
    if (s.t > maxTicks) {
      winner = "draw";
      emit(s, { t: s.t, kind: "end", winner, reason: `timeout after ${maxTicks} ticks` });
      break;
    }

    const actor = nextActor(s.units);
    if (!actor) {
      advance(s, ticksToNextEvent(s));
      updateStatuses(s);
      continue;
    }
    takeTurn(s, actor);
  }

  return { winner, ticks: s.t, log: s.log, units: s.units };
}

/** Commander layer: doctrines set squad intent. Ambushers hold until provoked. */
function updateIntent(s: BattleState, u: Unit): void {
  if (u.intent !== "hold") return;
  const d = s.scenario.doctrine;
  const radius = u.side === "player" ? s.rules.playerHold : d.kind === "hold" ? d.radius : 0;
  const squad = s.units.filter((v) => v.side === u.side);
  const provoked =
    // The player's squad doesn't wait forever for an enemy that won't come.
    (u.side === "player" && s.t > PLAYER_HOLD_LIMIT) ||
    squad.some((v) => !v.alive || v.hp < maxHp(v)) ||
    squad.some((v) => v.alive && s.units.some((e) => e.alive && e.side !== u.side && manhattan(e.pos, v.pos) <= radius));
  if (provoked) {
    for (const v of squad) v.intent = "engage";
    say(s, u, "advance", true);
  }
}

function takeTurn(s: BattleState, u: Unit): void {
  emit(s, s.opts.recordQueue ? { t: s.t, kind: "turn", uid: u.uid, queue: projectTurnOrder(s.units, 8) } : { t: s.t, kind: "turn", uid: u.uid });
  firePassives(s, u, "onTurnStart");
  if (!u.alive) return;
  updateIntent(s, u);

  const { choice, candidates } = decide(s, u);
  if (s.opts.debug) emit(s, { t: s.t, kind: "decide", uid: u.uid, chosen: choice.label, candidates: debugCandidates(candidates) });

  u.idle = choice.kind === "wait" ? u.idle + 1 : choice.reason === "retreat" ? u.idle : 0;
  switch (choice.kind) {
    case "ability":
      if (choice.reason !== "attack") say(s, u, choice.reason);
      executeAbility(s, u, choice.ability, choice.target);
      return;
    case "move": {
      if (choice.reason !== "advance" || u.lastReason === null) say(s, u, choice.reason);
      const from = { ...u.pos };
      const cost = stepCostAt(u, s.grid, choice.to);
      // Enemies adjacent before the step and not after may punish the disengage.
      const leaving = s.units.filter((e) => e.alive && e.side !== u.side && manhattan(e.pos, from) === 1 && manhattan(e.pos, choice.to) > 1);
      for (const e of leaving) firePassives(s, e, "onEnemyDisengage", u, { melee: true });
      u.gauge -= cost;
      if (!u.alive) return;
      const wasInRange = s.rules.charge && anyTargetInRange(s, u);
      u.pos = { ...choice.to };
      emit(s, { t: s.t, kind: "move", uid: u.uid, from, to: { ...choice.to }, cost });
      // Charge: closing into range lets the unit strike now, paying with gauge debt.
      // This removes the penalty for being the one who steps into range first.
      if (s.rules.charge && !wasInRange && u.alive) {
        const strike = decide(s, u, { abilitiesOnly: true }).choice;
        if (strike.kind === "ability") {
          say(s, u, strike.reason === "attack" ? "advance" : strike.reason);
          executeAbility(s, u, strike.ability, strike.target);
        }
      }
      return;
    }
    case "wait":
      u.gauge -= WAIT_COST;
      emit(s, { t: s.t, kind: "wait", uid: u.uid, cost: WAIT_COST });
      return;
  }
}

function anyTargetInRange(s: BattleState, u: Unit): boolean {
  return u.abilities.some((a) => a.target === "enemy" && s.units.some((e) => e.alive && e.side !== u.side && inRangeFrom(s, u, a, u.pos, e)));
}

/** Opening turn order for the setup screen preview, given placements. */
export function previewTurnOrder(content: Content, scenarioId: string, n: number, opts: BattleOptions = {}): { units: UnitSnapshot[]; order: number[] } {
  const s = setupBattle(content, scenarioId, 0, opts);
  return { units: s.units.map(snapshot), order: projectTurnOrder(s.units, n) };
}
