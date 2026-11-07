import { debugCandidates, decide, hasContact, isFragile, PLAN_SKILL, roleOf, tacticsSkill } from "./ai.js";
import { advance, fillRate, nextActor, openingGauge, projectTurnOrder, THRESHOLD, ticksToNextEvent } from "./clock.js";
import { basicAttack, executeAbility, inRangeFrom } from "./combat.js";
import { firePassives, say } from "./effects.js";
import { arrangeFormation } from "./formation.js";
import { Grid, firstStep, manhattan, pathCosts } from "./grid.js";
import { Rng } from "./rng.js";
import { idiv } from "./math.js";
import { DEFAULT_RULES, DEFAULT_WEIGHTS, emit, type BattleOptions, type BattleState, type Rules } from "./state.js";
import { updateStatuses } from "./statuses.js";
import { maxHp } from "./stats.js";
import { canLeap, edgeCost } from "./movement.js";
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

/** Ticks the player's squad will hold before advancing anyway (rules.playerHold). */
const PLAYER_HOLD_LIMIT = 150;

export { DEFAULT_WEIGHTS };

function need<T>(table: Record<string, T>, id: string, what: string): T {
  const v = table[id];
  if (!v) throw new Error(`unknown ${what} '${id}'`);
  return v;
}

/** Build a runtime unit from content. Layers: personal + race -> class -> gear -> passives. */
/** Run-persistent extras layered onto a unit: progression mods and extra trinkets. */
export interface UnitExtras {
  mods?: Modifier[];
  trinkets?: string[];
}

export function createUnit(content: Content, unitId: string, side: Side, uid: number, extras: UnitExtras = {}): Unit {
  const def = need(content.units, unitId, "unit");
  const race = need(content.races, def.raceId, "race");
  const cls = need(content.classes, def.classId, "class");
  const weapon = need(content.weapons, def.weaponId, "weapon");
  const trinkets = [...def.trinkets, ...(extras.trinkets ?? [])].map((id) => need(content.trinkets, id, "trinket"));
  const traits: TraitDef[] = def.traits.map((id) => need(content.traits, id, "trait"));

  const base: Stats = { ...def.stats };
  for (const [k, v] of Object.entries(race.statBonus)) base[k as keyof Stats] += v ?? 0;

  const passiveIds = [...race.passives, ...cls.passives, ...(weapon.passives ?? []), ...trinkets.flatMap((t) => t.passives ?? []), ...traits.flatMap((t) => t.passives ?? [])];
  const passives: PassiveDef[] = [...new Set(passiveIds)].map((id) => need(content.passives, id, "passive"));

  const staticMods: Modifier[] = [
    ...Object.entries(cls.baseBonus).map(([k, v]) => ({ key: k as keyof Stats, op: "flat" as const, value: v ?? 0 })),
    ...trinkets.flatMap((t) => t.mods),
    ...passives.flatMap((p) => p.mods ?? []),
    ...(extras.mods ?? []),
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
    committed: null,
    plan: null,
    lastStep: null,
    post: null,
    posture: null,
    evasion: 0,
    lastTurn: null,
    tacticsBase: Math.max(0, (def.tactics ?? cls.tactics ?? (cls.tags.includes("beast") ? 20 : 40)) + traits.reduce((a, t) => a + (t.tactics ?? 0), 0)),
    cache: new Map(),
  };
  const abilities: AbilityDef[] = [basicAttack(u), ...cls.abilities.map((id) => need(content.abilities, id, "ability"))];
  u.abilities = abilities;
  u.hp = maxHp(u);
  return u;
}

const scaledCache = new WeakMap<AbilityDef, Map<number, AbilityDef>>();

/** An ability at a different pacing (rules.actionScale): cost, cooldown and per-action status pressure scaled. */
function scaledAbility(a: AbilityDef, k: number): AbilityDef {
  let byK = scaledCache.get(a);
  if (!byK) scaledCache.set(a, (byK = new Map()));
  let out = byK.get(k);
  if (!out) {
    out = {
      ...a,
      cost: Math.max(1, idiv(a.cost * k, 100)),
      cooldown: idiv(a.cooldown * k, 100),
      effects: a.effects.map((e) =>
        e.kind === "buildup" || e.kind === "gauge" ? { ...e, amount: idiv(e.amount * k, 100) } : e,
      ),
    };
    byK.set(k, out);
  }
  return out;
}

export function setupBattle(content: Content, scenarioId: string, seed: number, opts: BattleOptions = {}): BattleState {
  const scenario = need(content.scenarios, scenarioId, "scenario");
  const grid = new Grid(scenario.map, scenario.heights);
  const rules: Rules = { ...DEFAULT_RULES, ...opts.rules };
  const benched = new Set(opts.benched ?? []);
  // A run's roster replaces the scenario's preset player units; they start at the anchor and form up.
  // Default anchor: the centre of the scenario's own player positions (as single battles form up).
  const presets = scenario.units.filter((su) => su.side === "player");
  const anchor = opts.anchor ?? {
    x: Math.round(presets.reduce((a, su) => a + su.pos.x, 0) / Math.max(1, presets.length)),
    y: Math.round(presets.reduce((a, su) => a + su.pos.y, 0) / Math.max(1, presets.length)),
  };
  const entries: { unitId: string; side: Side; pos: Pos; extras?: UnitExtras; index: number; post?: number }[] = opts.roster
    ? [
        ...opts.roster.map((r) => ({ unitId: r.unitId, side: "player" as const, pos: anchor, extras: r, index: -1 })),
        ...scenario.units.flatMap((su, i) => (su.side === "enemy" ? [{ ...su, index: i }] : [])),
      ]
    : scenario.units.map((su, i) => ({ ...su, index: i }));
  const units: Unit[] = [];
  entries.forEach((su) => {
    const i = su.index;
    if (i >= 0 && benched.has(i)) return;
    const u = createUnit(content, su.unitId, su.side, units.length, su.extras);
    if (su.post !== undefined) u.post = su.post;
    if (su.side === "enemy" && scenario.enemyMods) u.staticMods.push(...scenario.enemyMods);
    if (su.side === "enemy" && opts.enemyPower) {
      u.staticMods.push({ key: "hp", op: "pct", value: opts.enemyPower }, { key: "damageDealt", op: "pct", value: opts.enemyPower });
    }
    if (rules.hpScale !== 100) u.staticMods.push({ key: "hp", op: "pct", value: rules.hpScale - 100 });
    if (rules.moveScale !== 100) u.staticMods.push({ key: "moveCost", op: "pct", value: rules.moveScale - 100 });
    // Base AI weights: shift every unit by the difference from the defaults (traits stay on top).
    if (rules.baseWeights !== DEFAULT_WEIGHTS) {
      for (const k of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
        u.weights[k] = Math.max(0, u.weights[k] + (rules.baseWeights[k] ?? DEFAULT_WEIGHTS[k]) - DEFAULT_WEIGHTS[k]);
      }
    }
    if (rules.actionScale !== 100) u.abilities = u.abilities.map((a) => scaledAbility(a, rules.actionScale));
    u.cache.clear();
    u.hp = maxHp(u);
    u.pos = { ...((i >= 0 ? opts.placements?.[i] : undefined) ?? su.pos) };
    units.push(u);
  });

  if (rules.formation && opts.anchorShift) {
    const z = scenario.deployZone;
    for (const u of units) {
      if (u.side !== "player") continue;
      u.pos = {
        x: Math.min(z.x1, Math.max(z.x0, u.pos.x + opts.anchorShift.x)),
        y: Math.min(z.y1, Math.max(z.y0, u.pos.y + opts.anchorShift.y)),
      };
    }
  }

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
    if (u.post !== null) u.intent = "hold";
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
    classId: u.cls.id,
    raceId: u.race.id,
    weaponId: u.weapon.id,
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
    ...(s.scenario.heights ? { heights: [...s.scenario.heights] } : {}),
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

    const actor = nextActor(s.units, s.rules.ties);
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
  if (u.post !== null) {
    // A posted unit answers only to threats to itself.
    const post = u.post;
    // ...or once battle pressure has fully set in: a last stand, not a stalemate.
    const late = s.t > s.rules.pressureStart + s.rules.pressureSpan;
    if (late || u.hp < maxHp(u) || s.units.some((e) => e.alive && e.side !== u.side && manhattan(e.pos, u.pos) <= post)) {
      u.intent = "engage";
      say(s, u, "advance", true);
    }
    return;
  }
  const d = s.scenario.doctrine;
  const radius = u.side === "player" ? s.rules.playerHold : d.kind === "hold" ? d.radius : 0;
  const squad = s.units.filter((v) => v.side === u.side);
  const provoked =
    // The player's squad doesn't wait forever for an enemy that won't come.
    (u.side === "player" && s.t > PLAYER_HOLD_LIMIT) ||
    squad.some((v) => !v.alive || v.hp < maxHp(v)) ||
    squad.some((v) => v.alive && s.units.some((e) => e.alive && e.side !== u.side && manhattan(e.pos, v.pos) <= radius));
  if (provoked) {
    for (const v of squad) if (v.post === null) v.intent = "engage";
    say(s, u, "advance", true);
  }
}

function takeTurn(s: BattleState, u: Unit): void {
  emit(
    s,
    s.opts.recordQueue
      ? {
          t: s.t,
          kind: "turn",
          uid: u.uid,
          queue: projectTurnOrder(s.units, 8, s.rules.ties),
          gauge: s.units.map((x) => (x.alive ? x.gauge : 0)),
          rate: s.units.map((x) => (x.alive ? fillRate(x) : 0)),
        }
      : { t: s.t, kind: "turn", uid: u.uid },
  );
  firePassives(s, u, "onTurnStart");
  if (!u.alive) return;
  updateIntent(s, u);
  tickCommitment(s, u);

  // Stride: keep walking an existing plan without re-deciding, unless something changed.
  if (u.plan) {
    const step = nextPlanStep(s, u);
    if (step) {
      u.plan!.steps--;
      doMove(s, u, step);
      if (u.plan && (u.plan.steps <= 0 || (u.pos.x === u.plan.dest.x && u.pos.y === u.plan.dest.y))) u.plan = null;
      return;
    }
    u.plan = null;
  }

  const posture = u.posture ? `[${u.posture.kind} ${u.posture.steps}] ` : s.rules.retreatLimit > 0 && u.evasion >= s.rules.retreatLimit ? "[forced] " : "";
  const { choice, candidates } = decide(s, u);
  if (s.opts.debug) emit(s, { t: s.t, kind: "decide", uid: u.uid, chosen: posture + choice.label, candidates: debugCandidates(candidates) });

  u.idle = choice.kind === "wait" ? u.idle + 1 : choice.reason === "retreat" ? u.idle : 0;
  afterChoice(s, u, choice);
  switch (choice.kind) {
    case "ability":
      if (choice.reason !== "attack") say(s, u, choice.reason);
      if (choice.target.side !== u.side) u.committed = choice.target.uid;
      executeAbility(s, u, choice.ability, choice.target);
      return;
    case "move": {
      if (choice.reason !== "advance" || u.lastReason === null) say(s, u, choice.reason);
      if (choice.target) u.committed = choice.target.uid;
      const dest = choice.dest;
      if (s.rules.stride > 1 && dest && (dest.x !== choice.to.x || dest.y !== choice.to.y)) {
        u.plan = { dest: { ...dest }, steps: s.rules.stride - 1, hp: u.hp, reason: choice.reason };
      }
      doMove(s, u, choice.to);
      return;
    }
    case "wait":
      // Holding breaks momentum: next turn the unit may go back the way it came.
      u.lastStep = null;
      const waitCost = Math.max(1, idiv(s.rules.waitCost * s.rules.actionScale, 100));
      u.gauge -= waitCost;
      emit(s, { t: s.t, kind: "wait", uid: u.uid, cost: waitCost });
      return;
  }
}

function nearestDist(s: BattleState, u: Unit, p: Pos): number {
  let best = Infinity;
  for (const e of s.units) if (e.alive && e.side !== u.side) best = Math.min(best, manhattan(e.pos, p));
  return best;
}

const FORCED_LINES = ["Enough running!", "No more hiding.", "Here I come!", "Now or never!"];

/** Turn start: run the retreat clock and drop commitments that something unexpected broke. */
function tickCommitment(s: BattleState, u: Unit): void {
  if (u.lastTurn?.evasive && s.rules.retreatLimit > 0) {
    const before = u.evasion;
    u.evasion += s.t - u.lastTurn.t;
    if (before < s.rules.retreatLimit && u.evasion >= s.rules.retreatLimit && u.intent !== "hold") {
      emit(s, { t: s.t, kind: "say", uid: u.uid, text: FORCED_LINES[(s.t + u.uid) % FORCED_LINES.length]!, reason: "advance" });
    }
  }
  const p = u.posture;
  if (!p) return;
  const lost = p.hp - u.hp;
  const target = p.target === null ? null : s.units[p.target];
  if (lost * 100 >= maxHp(u) * s.rules.commitBreak || (target && !target.alive)) u.posture = null;
}

/** After deciding: start, continue or finish a commitment; note whether the turn backed off. */
function afterChoice(s: BattleState, u: Unit, choice: ReturnType<typeof decide>["choice"]): void {
  // Backing off or hovering: any turn that neither acts nor closes on the enemy (orders to hold excepted).
  const closes = choice.kind === "move" && nearestDist(s, u, choice.to) < nearestDist(s, u, u.pos);
  // A flanker biding its time until its front line makes contact isn't running away.
  const lurking = roleOf(u) === "flanker" && tacticsSkill(u, s.rules) >= PLAN_SKILL && !hasContact(s, u);
  u.lastTurn = { t: s.t, evasive: u.intent !== "hold" && choice.kind !== "ability" && !closes && !lurking };
  if (choice.kind === "ability") {
    // Acting (healers healing included) resets the retreat clock; attacking completes an engagement.
    u.evasion = 0;
    if (choice.target.side !== u.side && u.posture?.kind === "engage") u.posture = null;
    return;
  }
  if (u.posture) {
    if (--u.posture.steps <= 0) u.posture = null;
    return;
  }
  if (s.rules.commit <= 0 || choice.kind !== "move") return;
  const kind = choice.reason === "retreat" ? "reposition" : "engage";
  // Archers, mages and healers aren't held to an advance: holding at the edge of range is
  // their right play (forcing them in hands the fight to whoever moves second). The retreat
  // clock still stops them hovering forever.
  if (kind === "engage" && isFragile(u)) return;
  // Nor is a flanker that's still biding its time.
  if (kind === "engage" && lurking) return;
  // Engaging lasts until the unit attacks (capped, in case it never gets there); repositioning lasts `commit` steps.
  const steps = (kind === "engage" ? 4 * s.rules.commit : s.rules.commit) - 1;
  if (steps > 0) u.posture = { kind, steps, hp: u.hp, target: kind === "engage" ? (choice.target?.uid ?? null) : null };
}

function doMove(s: BattleState, u: Unit, to: Pos): void {
  const from = { ...u.pos };
  const cost = Math.max(0, edgeCost(u, s.grid, from, to));
  // Enemies adjacent before the step and not after may punish the disengage.
  const leaving = s.units.filter((e) => e.alive && e.side !== u.side && manhattan(e.pos, from) === 1 && manhattan(e.pos, to) > 1);
  for (const e of leaving) firePassives(s, e, "onEnemyDisengage", u, { melee: true });
  u.gauge -= cost;
  if (!u.alive) return;
  const wasInRange = s.rules.charge && anyTargetInRange(s, u);
  u.pos = { ...to };
  u.lastStep = { from, hp: u.hp };
  emit(s, { t: s.t, kind: "move", uid: u.uid, from, to: { ...to }, cost });
  // Charge: closing into range lets the unit strike now, paying with gauge debt.
  // This removes the penalty for being the one who steps into range first.
  if (s.rules.charge && !wasInRange && u.alive) {
    u.plan = null;
    const strike = decide(s, u, { abilitiesOnly: true }).choice;
    if (strike.kind === "ability") {
      say(s, u, strike.reason === "attack" ? "advance" : strike.reason);
      if (strike.target.side !== u.side) u.committed = strike.target.uid;
      executeAbility(s, u, strike.ability, strike.target);
    }
  }
}

/**
 * The next step of a unit's move plan, or null if the plan should be dropped:
 * it got hurt, an enemy is now in range, its target fell, or the way is blocked.
 */
function nextPlanStep(s: BattleState, u: Unit): Pos | null {
  const plan = u.plan!;
  if (u.hp < plan.hp || plan.steps <= 0 || anyTargetInRange(s, u)) return null;
  if (u.committed !== null && !s.units[u.committed]?.alive) return null;
  const occupied = new Uint8Array(s.grid.width * s.grid.height);
  for (const v of s.units) if (v.alive && v !== u) occupied[s.grid.index(v.pos)] = 1;
  const { prev, cost } = pathCosts(
    s.grid,
    u.pos,
    (from, to) => edgeCost(u, s.grid, from, to),
    (p) => occupied[p.y * s.grid.width + p.x] === 0,
    THRESHOLD * 5,
    canLeap(u),
  );
  if (cost[s.grid.index(plan.dest)]! < 0) return null;
  return firstStep(s.grid, prev, u.pos, plan.dest);
}

function anyTargetInRange(s: BattleState, u: Unit): boolean {
  return u.abilities.some((a) => a.target === "enemy" && s.units.some((e) => e.alive && e.side !== u.side && inRangeFrom(s, u, a, u.pos, e)));
}

/** Opening turn order for the setup screen preview, given placements. */
export function previewTurnOrder(content: Content, scenarioId: string, n: number, opts: BattleOptions = {}): { units: UnitSnapshot[]; order: number[] } {
  const s = setupBattle(content, scenarioId, 0, opts);
  return { units: s.units.map(snapshot), order: projectTurnOrder(s.units, n, s.rules.ties) };
}
