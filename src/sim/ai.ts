import { THRESHOLD } from "./clock.js";
import { affected, basicAttack, elevationPct, inRangeFrom, isRangedAbility, type LuckRules, isReady, landChance, stageChances } from "./combat.js";
import { computePacket, powerOf } from "./damage.js";
import { firstStep, manhattan, pathCosts } from "./grid.js";
import { idiv } from "./math.js";
import { alliesOf, enemiesOf, type BattleState } from "./state.js";
import { hasStatus, hasStatusTag, maxHp, stat } from "./stats.js";
import { canLeap, edgeCost, isFlyer, jumpOf } from "./movement.js";
import type { CandidateDebug } from "./log.js";
import type { AbilityDef, Doctrine, Pos, Reason, Unit, Weights } from "./types.js";

/**
 * Utility AI. On its turn a unit generates a bounded set of candidate actions,
 * scores each with weighted considerations, and picks the best. Personality is
 * the weights. The top consideration supplies the speech-bubble reason.
 *
 * Score units: roughly "percent of a target's max HP", so 40 = a big hit.
 */

export type Choice =
  | { kind: "ability"; ability: AbilityDef; target: Unit; reason: Reason; score: number; label: string; parts: Record<string, number> }
  | {
      kind: "move";
      to: Pos;
      reason: Reason;
      score: number;
      label: string;
      parts: Record<string, number>;
      /** Where this step is heading (for multi-step plans) and who it's after. */
      dest?: Pos;
      target?: Unit;
    }
  | { kind: "wait"; reason: Reason; score: number; label: string; parts: Record<string, number> };

interface Ctx {
  s: BattleState;
  me: Unit;
  w: Weights;
  enemies: Unit[];
  allies: Unit[];
  dangerCache: Map<number, number>;
  threats: { e: Unit; exp: number; reach: number; melee: boolean; climb: number }[];
  /** Squad focus-fire target (rules.focusFire, player side). */
  focus: Unit | null;
}

/** The squad's shared target: the enemy nearest the squad's centre, weakest first on ties. */
function squadFocus(allies: Unit[], enemies: Unit[]): Unit | null {
  if (allies.length === 0) return null;
  const cx = allies.reduce((a, u) => a + u.pos.x, 0) / allies.length;
  const cy = allies.reduce((a, u) => a + u.pos.y, 0) / allies.length;
  let best: Unit | null = null;
  let bestScore = Infinity;
  for (const e of enemies) {
    const score = (Math.abs(e.pos.x - cx) + Math.abs(e.pos.y - cy)) * 10 + e.hp;
    if (score < bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

const PRESSURE_START = 300;
const PRESSURE_SPAN = 300;

/** Statuses bend personality: fear makes safety loom large; frenzy forgets it. */
export function effectiveWeights(u: Unit, t = 0, doctrine?: Doctrine): Weights {
  const w = { ...u.weights };
  // Commander orders: an advancing squad presses a little harder. (Careful: in mirror
  // matches the side that walks into range first loses, so keep this mild.)
  if (doctrine && u.side === "enemy" && doctrine.kind !== "hold") w.aggression += 2;
  // Battle pressure: after a while caution decays for everyone, so endless chases and kiting end.
  if (t > PRESSURE_START) w.danger = idiv(w.danger * Math.max(0, PRESSURE_SPAN - (t - PRESSURE_START)), PRESSURE_SPAN);
  // Impatience: every turn spent holding erodes caution, so standoffs end.
  if (u.idle > 0 && u.intent !== "hold") w.danger = idiv(w.danger * Math.max(0, 10 - 2 * u.idle), 10);
  if (hasStatusTag(u, "fear")) {
    w.danger *= 3;
    w.aggression = idiv(w.aggression, 3);
    w.damage = idiv(w.damage * 6, 10);
  }
  if (hasStatusTag(u, "frenzy")) {
    w.danger = 0;
    w.aggression += 10;
  }
  return w;
}

export function decide(s: BattleState, me: Unit, opts: { abilitiesOnly?: boolean } = {}): { choice: Choice; candidates: Choice[] } {
  const ctx: Ctx = {
    s,
    me,
    w: effectiveWeights(me, s.t, s.scenario.doctrine),
    enemies: enemiesOf(s, me),
    allies: alliesOf(s, me),
    dangerCache: new Map(),
    threats: [],
    focus: null,
  };
  if (s.rules.focusFire && me.side === "player") ctx.focus = squadFocus(ctx.allies, ctx.enemies);
  if (me.committed !== null && !s.units[me.committed]?.alive) me.committed = null;
  // Shared threat picture for this decision: what each enemy could do to me before my next turn.
  for (const e of ctx.enemies) {
    const moveTiles = idiv(THRESHOLD, Math.max(1, stat(e, "moveCost"))) + 1;
    let exp = 0;
    let range = 1;
    let melee = true;
    for (const a of e.abilities) {
      if (a.target !== "enemy" || !isReady(s, e, a)) continue;
      exp = Math.max(exp, expected(e, me, a, a.range.max, s.rules).exp);
      range = Math.max(range, a.range.max);
      if (isRangedAbility(a)) melee = false;
    }
    // An enemy spreads its attention: split its threat across everyone on my side it could reach.
    const reach = moveTiles + range;
    const options = Math.max(1, ctx.allies.filter((a) => manhattan(a.pos, e.pos) <= reach).length);
    ctx.threats.push({ e, exp: idiv(exp * 2, options + 1), reach, melee, climb: isFlyer(e) ? 99 : jumpOf(e) });
  }

  const cands: Choice[] = [];
  const dangerHere = danger(ctx, me.pos);
  const dangerPenalty = (d: number) => idiv(d * ctx.w.danger, 10);

  // 1. Act from where I stand.
  for (const a of me.abilities) {
    if (!isReady(s, me, a)) continue;
    for (const t of targetsFor(ctx, a)) {
      if (!inRangeFrom(s, me, a, me.pos, t)) continue;
      const v = abilityValue(ctx, a, t, me.pos);
      if (v.value <= 0) continue;
      const perTick = idiv(v.value * 100, tempoCost(a.cost, ctx.w));
      const score = perTick - dangerPenalty(dangerHere);
      cands.push({
        kind: "ability",
        ability: a,
        target: t,
        reason: v.reason,
        score,
        label: `${a.name} -> ${t.name}`,
        parts: { ...v.parts, perTick, danger: -dangerPenalty(dangerHere) },
      });
    }
  }

  if (opts.abilitiesOnly) {
    // A follow-up action (charge): only act, never move or wait.
    let best: Choice = { kind: "wait", reason: "hold", score: 0, label: "hold", parts: {} };
    for (const c of cands) if (c.score > best.score) best = c;
    return { choice: best, candidates: cands };
  }

  // 2. Move toward a handful of tactical spots, one step at a time (re-evaluating each step).
  const occupied = new Uint8Array(s.grid.width * s.grid.height);
  for (const u of s.units) if (u.alive && u !== me) occupied[s.grid.index(u.pos)] = 1;
  const { cost, prev, order } = pathCosts(
    s.grid,
    me.pos,
    (from, to) => edgeCost(me, s.grid, from, to),
    (p) => occupied[p.y * s.grid.width + p.x] === 0,
    THRESHOLD * 5,
    canLeap(me),
  );
  // Reachable tiles, cheapest first (Dijkstra order), so spot searches can stop at the first hit.
  const reachable = order.slice(1);
  const reachablePos = reachable.map((i) => s.grid.posOf(i));
  const firstInRange = (a: AbilityDef, target: Unit): number => {
    for (let k = 0; k < reachable.length; k++) {
      const p = reachablePos[k]!;
      const d = manhattan(p, target.pos);
      if (d < a.range.min || d > a.range.max) continue;
      if (inRangeFrom(s, me, a, p, target)) return reachable[k]!;
    }
    return -1;
  };

  // Goals: for each target worth acting on, the cheapest tile to act from.
  interface Goal { perTick: number; spot: number; reason: Reason; target: Unit | null }
  const goals: Goal[] = [];
  const hereIdx = s.grid.index(me.pos);
  const holding = me.intent === "hold";
  if (!holding) {
    const nearest = [...ctx.enemies].sort((a, b) => manhattan(me.pos, a.pos) - manhattan(me.pos, b.pos) || a.uid - b.uid).slice(0, 4);
    for (const e of nearest) {
      for (const a of me.abilities) {
        if (a.target !== "enemy" || !isReady(s, me, a)) continue;
        const spot = inRangeFrom(s, me, a, me.pos, e) ? hereIdx : firstInRange(a, e);
        if (spot < 0) continue;
        const v = abilityValue(ctx, a, e, s.grid.posOf(spot));
        if (v.value > 0) goals.push({ perTick: idiv(v.value * 100, tempoCost(a.cost, ctx.w)), spot, reason: "advance", target: e });
      }
    }
    // Nothing in reach at all: march toward the nearest enemy.
    if (goals.length === 0 && nearest[0]) {
      let spot = -1;
      for (const i of reachable) {
        if (spot < 0 || manhattan(s.grid.posOf(i), nearest[0].pos) < manhattan(s.grid.posOf(spot), nearest[0].pos)) spot = i;
      }
      if (spot >= 0) goals.push({ perTick: 30, spot, reason: "advance", target: nearest[0] });
    }
  }
  // Healers want to be within reach of whoever is hurting most.
  const healAbility = me.abilities.find((a) => a.tags.includes("heal"));
  if (healAbility) {
    for (const ally of ctx.allies) {
      if (ally === me || ally.hp * 10 >= maxHp(ally) * 7) continue;
      const spot = inRangeFrom(s, me, healAbility, me.pos, ally) ? hereIdx : firstInRange(healAbility, ally);
      if (spot < 0) continue;
      const missing = idiv((maxHp(ally) - ally.hp) * 100, maxHp(ally));
      goals.push({ perTick: idiv(missing * ctx.w.support, 10), spot, reason: "support", target: null });
    }
  }

  const onPath = (spot: number, p: number): boolean => {
    for (let i = spot; i >= 0; i = prev[i]!) if (i === p) return true;
    return false;
  };
  /**
   * Position value: the best goal, discounted by the gauge still needed to get
   * there (aggression shrinks the discount), or acting straight from the tile.
   * Holding and stepping are both scored with this one function, so a unit
   * can't flip-flop between two tiles while nothing else changes.
   */
  const positionValue = (p: number): { value: number; reason: Reason; goal: Goal | null } => {
    let best: { value: number; reason: Reason; goal: Goal | null } = { value: 0, reason: "hold", goal: null };
    const aggr = Math.max(1, ctx.w.aggression);
    const cp = p === hereIdx ? 0 : cost[p]!;
    for (const g of goals) {
      const remaining = g.spot === p ? 0 : onPath(g.spot, p) ? cost[g.spot]! - cp : cost[g.spot]! + cp;
      // Floats here (not idiv): long distances must still leave a gradient to follow.
      // Plain IEEE arithmetic is deterministic across machines.
      const value = (g.perTick * 90) / (100 + (remaining * 10) / aggr);
      if (value > best.value) best = { value, reason: g.reason, goal: g };
    }
    if (p !== hereIdx) {
      const pos = s.grid.posOf(p);
      for (const a of me.abilities) {
        if (a.target !== "enemy" || !isReady(s, me, a)) continue;
        for (const e of ctx.enemies) {
          if (!inRangeFrom(s, me, a, pos, e)) continue;
          const value = (abilityValue(ctx, a, e, pos).value * 90) / tempoCost(a.cost, ctx.w);
          if (value > best.value) best = { value, reason: "advance", goal: null };
        }
      }
    }
    return best;
  };

  const here = positionValue(hereIdx);
  // Waiting gains nothing by itself: without orders to hold, ties go to moving.
  const holdScore = here.value - dangerPenalty(dangerHere) + (holding ? 5 : -2);
  cands.push({ kind: "wait", reason: "hold", score: holdScore, label: "hold", parts: { future: here.value, danger: -dangerPenalty(dangerHere) } });

  // Stepping away from an adjacent enemy who punishes disengaging costs a free hit.
  const engagers = ctx.enemies.filter((e) => manhattan(e.pos, me.pos) === 1 && e.passives.some((p) => p.trigger === "onEnemyDisengage"));
  const disengageCost = (to: Pos): number => {
    let pct = 0;
    for (const e of engagers) {
      if (manhattan(e.pos, to) > 1) pct += idiv(expected(e, me, basicAttack(e), 1, s.rules).exp * 100, Math.max(1, me.hp));
    }
    return idiv(pct * Math.max(4, ctx.w.danger), 10);
  };

  // Cohesion: before contact, don't run more than 2 tiles ahead of the nearest ally.
  const cohesionCost = (to: Pos): number => {
    if (!s.rules.cohesion || dangerHere > 0) return 0;
    let nearest = Infinity;
    for (const a of ctx.allies) if (a !== me) nearest = Math.min(nearest, manhattan(a.pos, to));
    return nearest === Infinity ? 0 : Math.max(0, nearest - 2) * s.rules.cohesion;
  };

  // One step at a time: each free neighbour, scored by its position value.
  for (const step of stepOptions(s, me)) {
    const i = s.grid.index(step);
    if (cost[i]! <= 0 || prev[i] !== hereIdx) continue;
    const pv = positionValue(i);
    const d = danger(ctx, step);
    const coh = cohesionCost(step);
    const score = pv.value - dangerPenalty(d) - disengageCost(step) - coh;
    const reason: Reason = d < dangerHere && pv.value <= here.value ? "retreat" : pv.reason === "hold" ? "advance" : pv.reason;
    const dest = pv.goal ? s.grid.posOf(pv.goal.spot) : step;
    cands.push({
      kind: "move",
      to: step,
      reason,
      score,
      label: `${reason} to ${step.x},${step.y}`,
      parts: { future: pv.value, danger: -dangerPenalty(d), cohesion: -coh },
      dest,
      ...(pv.goal?.target ? { target: pv.goal.target } : {}),
    });
  }

  // Escape a danger plateau: head for the safest tile within a few steps.
  if (dangerHere > 0) {
    let spot = -1;
    let spotDanger = dangerHere;
    for (const i of reachable) {
      if (cost[i]! > stat(me, "moveCost") * 4) break;
      const d = danger(ctx, s.grid.posOf(i));
      if (d < spotDanger) {
        spot = i;
        spotDanger = d;
      }
    }
    const step = spot >= 0 ? firstStep(s.grid, prev, me.pos, s.grid.posOf(spot)) : null;
    if (step) {
      const d = danger(ctx, step);
      if (spotDanger < d) {
        const pv = positionValue(s.grid.index(step));
        const score = pv.value - dangerPenalty(d) + idiv(dangerPenalty(d) - dangerPenalty(spotDanger), 2) - disengageCost(step);
        cands.push({
          kind: "move",
          to: step,
          reason: "retreat",
          score,
          label: `fall back to ${step.x},${step.y}`,
          parts: { future: pv.value, danger: -dangerPenalty(d) },
          dest: s.grid.posOf(spot),
        });
      }
    }
  }

  // Highest score wins; generation order breaks ties (deterministic).
  let choice = cands[0]!;
  for (const c of cands) if (c.score > choice.score) choice = c;
  return { choice, candidates: cands };
}

/** Tiles one move away: the 4 neighbours, plus 2-tile leaps over pits for jumpers. */
function stepOptions(s: BattleState, me: Unit): Pos[] {
  const out = s.grid.neighbours(me.pos);
  if (canLeap(me)) {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const mid = { x: me.pos.x + dx, y: me.pos.y + dy };
      const to = { x: me.pos.x + 2 * dx, y: me.pos.y + 2 * dy };
      if (s.grid.inBounds(to) && s.grid.tile(mid).pit) out.push(to);
    }
  }
  return out;
}

export function debugCandidates(cands: Choice[], n = 5): CandidateDebug[] {
  const r = (v: number) => Math.round(v * 10) / 10;
  return [...cands]
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((c) => ({ label: c.label, score: r(c.score), parts: Object.fromEntries(Object.entries(c.parts).map(([k, v]) => [k, r(v)])) }));
}

// ---------------------------------------------------------------- considerations

function targetsFor(ctx: Ctx, a: AbilityDef): Unit[] {
  if (a.target === "self") return [ctx.me];
  if (a.target === "ally") return ctx.allies;
  return ctx.enemies;
}

/** Spending big moves delays the next turn. tempo 10 judges value per gauge spent; lower favours big moves. */
function tempoCost(cost: number, w: Weights): number {
  return Math.max(30, 100 + idiv((cost - 100) * w.tempo, 10));
}

export function expected(att: Unit, v: Unit, a: AbilityDef, distance: number, luck?: LuckRules): { exp: number; raw: number; land: number } {
  let raw = 0;
  for (const e of a.effects) if (e.kind === "damage") raw += computePacket(att, v, e.packet, e.power, false).total;
  const land = a.check === "attack" && v.side !== att.side ? landChance(stageChances(att, v, a, distance), luck) : 100;
  return { exp: idiv(raw * land, 100), raw, land };
}

/** Expected HP loss at a tile before my next turn, as % of my current HP. */
function danger(ctx: Ctx, p: Pos): number {
  const key = ctx.s.grid.index(p);
  const cached = ctx.dangerCache.get(key);
  if (cached !== undefined) return cached;
  let sum = 0;
  const h = ctx.s.grid.heightAt(p);
  for (const t of ctx.threats) {
    if (manhattan(t.e.pos, p) > t.reach) continue;
    // A melee enemy below a cliff it can't climb is much less of a threat (it must walk around).
    const cliff = t.melee && h - ctx.s.grid.heightAt(t.e.pos) > Math.max(1, t.climb);
    sum += cliff ? idiv(t.exp, 3) : t.exp;
  }
  const pct = Math.min(300, idiv(sum * 100, Math.max(1, ctx.me.hp)));
  ctx.dangerCache.set(key, pct);
  return pct;
}

/** Doctrine target priorities (percent). */
function targetMult(ctx: Ctx, v: Unit): number {
  const base = doctrineMult(ctx, v);
  // Commitment: keep working on the current target unless another is clearly better.
  return ctx.s.rules.commitTarget && v.uid === ctx.me.committed ? idiv(base * 3, 2) : base;
}

function doctrineMult(ctx: Ctx, v: Unit): number {
  const d = ctx.s.scenario.doctrine;
  if (ctx.me.side !== "enemy") return v === ctx.focus ? 200 : 100;
  if (d.kind === "hunt" && v.cls.tags.includes(d.tag)) return 220;
  if (d.kind === "pack") {
    const friends = ctx.enemies.filter((o) => o !== v && manhattan(o.pos, v.pos) <= 2).length;
    return friends === 0 ? 180 : 100;
  }
  return 100;
}

function abilityValue(ctx: Ctx, a: AbilityDef, t: Unit, from: Pos): { value: number; reason: Reason; parts: Record<string, number> } {
  const { me, w } = ctx;
  const victims = affected(ctx.s, me, a, t, from);
  const hasDamage = a.effects.some((e) => e.kind === "damage");
  const heal = a.effects.find((e) => e.kind === "heal");

  if (heal && heal.kind === "heal") {
    let pts = 0;
    for (const v of victims) {
      if (v.side !== me.side) continue;
      const mhp = maxHp(v);
      const missing = mhp - v.hp;
      if (missing <= 0) continue;
      pts += idiv(Math.min(powerOf(me, heal.power), missing) * 100, mhp);
      if (v.hp * 2 < mhp) pts += 15;
    }
    const value = idiv(pts * w.support, 10);
    return { value, reason: "support", parts: { heal: value } };
  }

  if (!hasDamage && a.target !== "enemy") {
    // Buffs: only worth it if not already active on the targets.
    const statusIds = a.effects.flatMap((e) => (e.kind === "status" ? [e.status] : []));
    const fresh = victims.filter((v) => statusIds.some((id) => !hasStatus(v, id))).length;
    const value = fresh > 0 ? (a.aiValue ?? 10) * fresh : 0;
    return { value, reason: "rally", parts: { buff: value } };
  }

  let dmg = 0;
  let kill = 0;
  let rider = 0;
  let friendly = 0;
  let hostiles = 0;
  for (const v of victims) {
    const hostile = v.side !== me.side;
    const ex0 = expected(me, v, a, manhattan(from, v.pos), ctx.s.rules);
    // High ground matters to archers and mages: value it so they seek it out.
    const elev = elevationPct(ctx.s.grid, from, v.pos, a);
    const ex = { exp: idiv(ex0.exp * elev, 100), raw: idiv(ex0.raw * elev, 100), land: ex0.land };
    const mhp = maxHp(v);
    if (!hostile) {
      friendly += idiv(Math.min(ex.exp, v.hp) * 100, mhp);
      continue;
    }
    hostiles++;
    const mult = targetMult(ctx, v);
    dmg += idiv(idiv(Math.min(ex.exp, v.hp) * 100, mhp) * mult, 100);
    if (ex.raw >= v.hp && ex.raw > 0) kill += idiv(ex.land * mult, 100);
    for (const e of a.effects) {
      if (e.kind === "buildup") rider += idiv(e.amount * ex.land, 1000);
      else if (e.kind === "gauge") rider += idiv(-e.amount * ex.land, 300);
      else if (e.kind === "status") rider += idiv(15 * ex.land, 100);
    }
  }
  if (hostiles === 0) return { value: 0, reason: "attack", parts: {} };
  const dmgPts = idiv(dmg * w.damage, 10);
  const killPts = idiv(kill * w.kill, 10);
  const aoePts = idiv((hostiles - 1) * 12 * w.aoe, 10);
  const ffPts = idiv(friendly * 2 * Math.max(5, w.support), 10);
  const value = dmgPts + killPts + rider + aoePts - ffPts;
  const reason: Reason = killPts > dmgPts ? "finish" : hostiles > 1 ? "aoe" : "attack";
  return { value, reason, parts: { dmg: dmgPts, kill: killPts, rider, aoe: aoePts, friendlyFire: -ffPts } };
}

