/**
 * Minimal roguelike run loop. Pure TypeScript (no DOM, no Node), deterministic
 * from the run seed, shared by the browser and the headless auto-player.
 *
 * A run: fight encounters in turn; enemy strength ramps each battle. You keep a
 * roster that levels up, gets trained and equipped, and grows by recruiting.
 * Before each fight you choose who deploys (the map limits how many). Results
 * are settled (src/sim/settle.ts). Losing costs hearts by how badly it went;
 * at 0 hearts the run is over. After each battle you pick one reward.
 */
import { Rng, settleBattle, type Content, type Difficulty, type Modifier, type Pos, type SettleResult, type StatName } from "../sim/index.js";

export interface RunConfig {
  /** Encounters to draw from, cycled in a shuffled order. */
  encounters: string[];
  startingRoster: string[];
  hearts: number;
  maxHearts: number;
  /** Enemy strength increase per battle, percent. */
  ramp: number;
  difficulty: Difficulty;
  /** Sample battles per settled result. */
  samples: number;
  /** Most units the roster can hold. */
  maxRoster: number;
}

export const DEFAULT_RUN: RunConfig = {
  encounters: ["skirmish", "patrol", "foundry", "marsh", "wolves", "cliffs"],
  startingRoster: ["aldric", "wren", "oswin", "kesh", "sela"],
  hearts: 5,
  maxHearts: 5,
  ramp: 4,
  difficulty: "normal",
  samples: 24,
  maxRoster: 8,
};

export interface RosterUnit {
  unitId: string;
  level: number;
  /** XP towards the next level (see xpToNext). */
  xp: number;
  /** Flat stat bonuses from training. */
  training: Partial<Record<StatName, number>>;
  trinkets: string[];
  /** Knocked out last battle: deals 10% less damage in the next one. */
  fatigued: boolean;
  battles: number;
  knockouts: number;
}

export type Offer =
  | { kind: "recruit"; unitId: string; label: string }
  | { kind: "train"; unitId: string; stat: StatName; amount: number; label: string }
  | { kind: "trinket"; unitId: string; trinketId: string; label: string }
  | { kind: "rest"; label: string };

export interface BattleRecord {
  battle: number;
  scenario: string;
  enemyPower: number;
  deployed: string[];
  won: boolean;
  winProb: number;
  heartsLost: number;
  knockedOut: string[];
}

export interface RunState {
  seed: number;
  config: RunConfig;
  /** Index of the next battle (0-based). */
  battle: number;
  hearts: number;
  roster: RosterUnit[];
  order: string[];
  history: BattleRecord[];
  /** Rewards on offer after a battle; null while choosing a fight. */
  offers: Offer[] | null;
  over: boolean;
}

export interface Encounter {
  scenario: string;
  /** Percent added to enemy HP and damage. */
  enemyPower: number;
  /** How many units may deploy (fixed by the map). */
  slots: number;
}

/** XP needed to go from `level` to the next: growth is front-loaded and slows. */
export function xpToNext(level: number): number {
  return 100 + 50 * (level - 1);
}

function rngFor(run: RunState, salt: number): Rng {
  return new Rng(Math.imul(run.seed + 1, 0x9e3779b1) ^ Math.imul(run.battle + 1, 0x85ebca77) ^ salt);
}

function shuffled<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function newUnit(unitId: string): RosterUnit {
  return { unitId, level: 1, xp: 0, training: {}, trinkets: [], fatigued: false, battles: 0, knockouts: 0 };
}

export function newRun(seed: number, config: Partial<RunConfig> = {}): RunState {
  const cfg = { ...DEFAULT_RUN, ...config };
  const run: RunState = {
    seed,
    config: cfg,
    battle: 0,
    hearts: cfg.hearts,
    roster: cfg.startingRoster.map(newUnit),
    order: [],
    history: [],
    offers: null,
    over: false,
  };
  run.order = shuffled(cfg.encounters, rngFor(run, 0x51));
  return run;
}

export function currentEncounter(content: Content, run: RunState): Encounter {
  const cycle = Math.floor(run.battle / run.order.length);
  // Each cycle reshuffles the encounter order.
  const order = cycle === 0 ? run.order : shuffled(run.config.encounters, new Rng(run.seed * 31 + cycle));
  const scenario = order[run.battle % order.length]!;
  const sc = content.scenarios[scenario]!;
  return {
    scenario,
    enemyPower: run.config.ramp * run.battle,
    slots: sc.units.filter((u) => u.side === "player").length,
  };
}

/** The stat a class grows on level-up. */
export function mainStat(content: Content, unitId: string): StatName {
  const cls = content.classes[content.units[unitId]!.classId]!;
  if (cls.tags.includes("healer")) return "spirit";
  if (cls.id === "tactician") return "mind";
  if (cls.tags.includes("caster")) return "arcana";
  if (cls.tags.includes("ranged")) return "skill";
  return "strength";
}

/** Everything persistent about a roster unit, as modifiers for the battle engine. */
export function unitMods(content: Content, r: RosterUnit): Modifier[] {
  const mods: Modifier[] = [];
  const levels = r.level - 1;
  if (levels > 0) {
    // +2 HP per level, +1 main stat every other level: a few % of strength per level.
    mods.push({ key: "hp", op: "flat", value: 2 * levels });
    if (levels >= 2) mods.push({ key: mainStat(content, r.unitId), op: "flat", value: Math.floor(levels / 2) });
  }
  for (const [stat, v] of Object.entries(r.training)) if (v) mods.push({ key: stat as StatName, op: "flat", value: v });
  if (r.fatigued) mods.push({ key: "damageDealt", op: "pct", value: -10 });
  return mods;
}

/** Sensible default deployment: highest level first, then roster order. */
export function defaultDeployment(run: RunState, slots: number): string[] {
  return [...run.roster]
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.level - a.r.level || Number(a.r.fatigued) - Number(b.r.fatigued) || a.i - b.i)
    .slice(0, slots)
    .map((x) => x.r.unitId);
}

export interface FightResult {
  settle: SettleResult;
  record: BattleRecord;
}

/** Settle the current encounter for a deployment. Doesn't change the run; call `applyResult`. */
export function fight(content: Content, run: RunState, deployed: string[], anchor?: Pos, showSeed = 1, extra: { recordQueue?: boolean } = {}): FightResult {
  if (run.over || run.offers) throw new Error("not ready to fight");
  const enc = currentEncounter(content, run);
  if (deployed.length < 1 || deployed.length > enc.slots) throw new Error(`deploy 1-${enc.slots} units`);
  const roster = deployed.map((id) => {
    const r = run.roster.find((x) => x.unitId === id);
    if (!r) throw new Error(`${id} is not in the roster`);
    return { unitId: id, mods: unitMods(content, r), trinkets: r.trinkets };
  });
  const settle = settleBattle(
    content,
    enc.scenario,
    showSeed,
    { roster, ...(anchor ? { anchor } : {}), enemyPower: enc.enemyPower, ...extra },
    { difficulty: run.config.difficulty, samples: run.config.samples },
  );
  const result = settle.result;
  const won = result.winner === "player";
  // Battle units are created roster-first, in deployment order.
  const knockedOut = deployed.filter((_, i) => !result.units[i]!.alive);
  const heartsLost = won ? 0 : settle.margin < 35 ? 1 : settle.margin < 70 ? 2 : 3;
  return {
    settle,
    record: { battle: run.battle, scenario: enc.scenario, enemyPower: enc.enemyPower, deployed, won, winProb: settle.winProb, heartsLost, knockedOut },
  };
}

/** Apply a fought battle to the run: XP, fatigue, hearts, and the reward offers. */
export function applyResult(content: Content, run: RunState, rec: BattleRecord): void {
  run.history.push(rec);
  for (const r of run.roster) {
    const deployed = rec.deployed.includes(r.unitId);
    const ko = rec.knockedOut.includes(r.unitId);
    r.fatigued = ko;
    if (!deployed) continue;
    r.battles++;
    if (ko) r.knockouts++;
    // Knocked-out units learn less from the fight (design notes: knockout penalty).
    r.xp += ko ? 50 : 100;
    while (r.xp >= xpToNext(r.level)) {
      r.xp -= xpToNext(r.level);
      r.level++;
    }
  }
  run.hearts -= rec.heartsLost;
  if (run.hearts <= 0) {
    run.hearts = 0;
    run.over = true;
    run.offers = null;
    return;
  }
  run.offers = makeOffers(content, run, rec.won ? 3 : 2);
}

const TRAINABLE: StatName[] = ["hp", "strength", "skill", "speed", "agility", "defense", "arcana", "mind", "spirit", "resolve"];

function makeOffers(content: Content, run: RunState, n: number): Offer[] {
  const rng = rngFor(run, 0x0ff3);
  const name = (id: string) => content.units[id]!.name;
  const candidates: Offer[] = [];

  const recruitable = Object.values(content.units).filter(
    (u) => u.id && !run.roster.some((r) => r.unitId === u.id) && PLAYER_RECRUITS.includes(u.id),
  );
  if (recruitable.length && run.roster.length < run.config.maxRoster) {
    const u = recruitable[rng.int(recruitable.length)]!;
    const cls = content.classes[u.classId]!.name;
    candidates.push({ kind: "recruit", unitId: u.id, label: `Recruit ${u.name}, ${content.races[u.raceId]!.name} ${cls}` });
  }
  {
    const r = run.roster[rng.int(run.roster.length)]!;
    const main = mainStat(content, r.unitId);
    const stat = rng.int(2) === 0 ? main : TRAINABLE[rng.int(TRAINABLE.length)]!;
    const amount = stat === "hp" ? 4 : 2;
    candidates.push({ kind: "train", unitId: r.unitId, stat, amount, label: `Train ${name(r.unitId)}: +${amount} ${stat}` });
  }
  const trinketIds = Object.keys(content.trinkets);
  const holders = run.roster.filter((r) => r.trinkets.length + content.units[r.unitId]!.trinkets.length < 2);
  if (holders.length && trinketIds.length) {
    const r = holders[rng.int(holders.length)]!;
    const t = trinketIds[rng.int(trinketIds.length)]!;
    candidates.push({ kind: "trinket", unitId: r.unitId, trinketId: t, label: `${content.trinkets[t]!.name} for ${name(r.unitId)}` });
  }
  if (run.hearts < run.config.maxHearts) candidates.push({ kind: "rest", label: "Rest at a shrine: +1 heart" });
  // A second training offer keeps the choice open when the list is short.
  if (candidates.length < 4) {
    const r = run.roster[rng.int(run.roster.length)]!;
    const stat = mainStat(content, r.unitId);
    candidates.push({ kind: "train", unitId: r.unitId, stat, amount: 2, label: `Train ${name(r.unitId)}: +2 ${stat}` });
  }
  return shuffled(candidates, rng).slice(0, n);
}

/** Units that can join the player's company (the rest of the content is enemies). */
export const PLAYER_RECRUITS = ["vex", "sela", "mira", "ilya", "gorm", "aeris", "aldric", "wren", "oswin", "kesh"];

/** Take a reward and move on to the next battle. */
export function chooseOffer(run: RunState, index: number): void {
  const offer = run.offers?.[index];
  if (!offer) throw new Error("no such offer");
  switch (offer.kind) {
    case "recruit":
      run.roster.push(newUnit(offer.unitId));
      break;
    case "train": {
      const r = run.roster.find((x) => x.unitId === offer.unitId)!;
      r.training[offer.stat] = (r.training[offer.stat] ?? 0) + offer.amount;
      break;
    }
    case "trinket":
      run.roster.find((x) => x.unitId === offer.unitId)!.trinkets.push(offer.trinketId);
      break;
    case "rest":
      run.hearts = Math.min(run.config.maxHearts, run.hearts + 1);
      break;
  }
  run.offers = null;
  run.battle++;
}

export function battlesWon(run: RunState): number {
  return run.history.filter((h) => h.won).length;
}
