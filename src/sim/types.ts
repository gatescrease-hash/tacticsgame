/**
 * Core simulation types. Content (src/content) is plain data shaped by the
 * *Def types; runtime state (Unit, BattleState) is built from content at setup.
 */

export type Side = "player" | "enemy";

export interface Pos {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- stats

/** Each stat has one job no other stat does (design notes, "Stats and growth"). */
export interface Stats {
  hp: number;
  strength: number;
  skill: number;
  speed: number;
  agility: number;
  defense: number;
  arcana: number;
  mind: number;
  spirit: number;
  resolve: number;
  luck: number;
}

export type StatName = keyof Stats;
export const STAT_NAMES: readonly StatName[] = [
  "hp", "strength", "skill", "speed", "agility", "defense", "arcana", "mind", "spirit", "resolve", "luck",
];

/** Derived values: calculated from stats, class, race and armour, never rolled. */
/** damageDealt / damageTaken are percent multipliers on final damage (base 100). */
export type DerivedKey = "hit" | "dodge" | "parry" | "block" | "crit" | "armour" | "moveCost" | "fillRate" | "damageDealt" | "damageTaken";
export const DERIVED_KEYS: readonly DerivedKey[] = [
  "hit", "dodge", "parry", "block", "crit", "armour", "moveCost", "fillRate", "damageDealt", "damageTaken",
];

export type ModKey = StatName | DerivedKey;

/**
 * One entry in the modifier stack. Applied in a fixed order:
 * all flat bonuses, then all percentages, then caps (lowest cap wins).
 */
export interface Modifier {
  key: ModKey;
  op: "flat" | "pct" | "cap";
  value: number;
}

// ---------------------------------------------------------------- damage

export type PhysicalType = "slashing" | "piercing" | "bludgeoning";
export type DamageType = PhysicalType | "fire" | "lightning" | "light" | "psychic" | "spirit";
/** Force-pillar elements: they deal physical damage but carry riders. */
export type Element = "water" | "earth" | "wind";
export type Pillar = "force" | "energy" | "mind" | "spirit";

export type ArmourMaterial = "cloth" | "leather" | "chain" | "plate" | "stone";

/** Multiplier tiers stored as x2 integers: 0 immune, 1 resist (x0.5), 2 normal, 3 weak (x1.5). */
export type Tier = 0 | 1 | 2 | 3;

/** One component of a hit's damage packet, as a share (percent) of the hit's power. */
export interface PacketComponent {
  type: DamageType;
  element?: Element;
  share: number;
}

/** Where an effect's power comes from: weapon (Strength + might), a stat, plus a base. */
export interface Power {
  weapon?: boolean;
  stat?: StatName;
  /** Percent of the stat/weapon power used (default 100). */
  scale?: number;
  base: number;
}

// ---------------------------------------------------------------- creatures and races

export type Essence = "none" | "some" | "high";

/** What keeps a creature going decides what can hurt it. */
export interface CreatureProfile {
  mind: boolean;
  essence: Essence;
  /** Body tags: flesh, construct, metal, mud, beast... */
  tags: string[];
}

export interface RaceDef {
  id: string;
  name: string;
  profile: CreatureProfile;
  statBonus: Partial<Stats>;
  /** Per damage type or element tier overrides (e.g. golems immune to fire). */
  resist?: Partial<Record<DamageType | Element, Tier>>;
  passives: string[];
  /** Classes this body can't take. */
  lockedClasses?: string[];
  /** Movement tags: "swampwalker" ignores swamp slowdown; "flyer" ignores height and pits. */
  moveTags?: string[];
  /** Metres this body can climb (default 1). 2+ also leaps single pits. */
  jump?: number;
}

// ---------------------------------------------------------------- classes and gear

export interface ClassDef {
  id: string;
  name: string;
  /** Armour is class identity, not a swappable item. Weight slows the gauge unless Strength carries it. */
  armour: { material: ArmourMaterial; value: number; weight: number };
  /** Gauge cost per tile moved. */
  moveCost: number;
  /** Metres this class can climb (default 1). 2+ also leaps single pits: skirmishers, beasts. */
  jump?: number;
  /** Flat bonus (or penalty) for being in the class. */
  baseBonus: Partial<Stats>;
  weaponTypes: string[];
  abilities: string[];
  passives: string[];
  /** Role tags readable by doctrines and scouting: heavy, ranged, healer, caster... */
  tags: string[];
}

export interface WeaponDef {
  id: string;
  name: string;
  type: string;
  packet: PacketComponent[];
  might: number;
  accuracy: number;
  /** Gauge cost of one attack. Big moves delay the next turn. */
  cost: number;
  range: { min: number; max: number };
  canParry: boolean;
  ignoresParry: boolean;
  passives?: string[];
}

export interface TrinketDef {
  id: string;
  name: string;
  mods: Modifier[];
  passives?: string[];
}

// ---------------------------------------------------------------- statuses

export interface StatusDef {
  id: string;
  name: string;
  /** One or two letters for the playback icon. */
  short: string;
  /** Build-up threshold. Hits fill a meter; the status triggers when it's full. */
  threshold: number;
  /** Duration in ticks. */
  duration: number;
  /** Damage over time: `damage` every `every` ticks. Ignores mitigation. */
  dot?: { damage: number; every: number };
  mods?: Modifier[];
  /** Stops the action gauge filling (stun). */
  freezesGauge?: boolean;
  /** Creature tags that are immune (constructs don't bleed). */
  immuneTags?: string[];
  /** Statuses removed when this one lands (wet puts out burning). */
  removes?: string[];
  /** Behaviour tags read by the AI: "fear" makes a unit value safety much more. */
  tags?: string[];
  /** Build-up resisted by this stat (default luck). */
  resistStat?: StatName;
}

// ---------------------------------------------------------------- abilities and effects

export type Effect =
  | { kind: "damage"; packet: PacketComponent[]; power: Power }
  | { kind: "buildup"; status: string; amount: number }
  | { kind: "status"; status: string }
  | { kind: "gauge"; amount: number }
  | { kind: "heal"; power: Power }
  | { kind: "push"; tiles: number };

export type Shape = { kind: "single" } | { kind: "radius"; r: number } | { kind: "line"; length: number };

export interface AbilityDef {
  id: string;
  name: string;
  /** Gauge cost. */
  cost: number;
  /** Cooldown in ticks so it stays fair across speeds. */
  cooldown: number;
  range: { min: number; max: number };
  /** Who you point it at. */
  target: "enemy" | "ally" | "self";
  shape: Shape;
  /** Who inside the shape is affected. */
  affects: "enemies" | "allies" | "all";
  /** "attack" runs aim + reaction stages; "auto" always lands (mitigation still applies). */
  check: "attack" | "auto";
  effects: Effect[];
  /** "melee", "suppress" (no counters), "aoe", "heal", "buff"... */
  tags: string[];
  /** Extra AI value for effects the scorer can't price (buffs). */
  aiValue?: number;
  say?: string[];
}

export type TriggerKind =
  | "onHit" // I damaged someone (other = them)
  | "onBeingHit" // someone damaged me (other = them)
  | "onBeingAttacked" // someone attacked me, any outcome (counters)
  | "onTurnStart"
  | "onHpBelow50"
  | "onHpBelow25"
  | "onAllyKnockedOut" // an ally within 2 tiles went down (other = them)
  | "onEnemyDisengage"; // an adjacent enemy stepped away (other = them)

export interface PassiveDef {
  id: string;
  name: string;
  /** Static modifiers while the passive is owned. */
  mods?: Modifier[];
  trigger?: TriggerKind;
  /** Respond with a free basic attack on `other` (counterattack / engagement). */
  counter?: boolean;
  effects?: Effect[];
  /** Who effects land on. */
  effectTarget?: "self" | "other";
  /** Only fire once per battle. */
  once?: boolean;
  say?: string[];
}

// ---------------------------------------------------------------- personality

/** Utility-AI weights. Personality is the weights; training will adjust the numbers. ~10 = normal. */
export interface Weights {
  /** Value of expected damage. */
  damage: number;
  /** Value of finishing a target. */
  kill: number;
  /** Fear of standing where enemies can hit you. */
  danger: number;
  /** Value of healing and protecting allies. */
  support: number;
  /** Love of hitting several targets at once. */
  aoe: number;
  /** 10 = judge actions per tick spent; lower prefers slow, big moves. */
  tempo: number;
  /** Appetite for closing in on enemies. */
  aggression: number;
}

export type Reason =
  | "attack" | "finish" | "aoe" | "support" | "advance" | "retreat" | "hold"
  | "shaken" | "frenzy" | "rally" | "allyDown" | "steady" | "counter";

export interface TraitDef {
  id: string;
  name: string;
  weights: Partial<Weights>;
  /** Added to Resolve for morale checks. */
  resolve: number;
  passives?: string[];
  /** Morale result when a check fails / passes at an HP threshold. */
  onBreak?: "shaken" | "frenzy";
  lines?: Partial<Record<Reason, string[]>>;
}

// ---------------------------------------------------------------- units and scenarios

export interface UnitDef {
  id: string;
  name: string;
  raceId: string;
  classId: string;
  weaponId: string;
  trinkets: string[];
  /** Personal stats. */
  stats: Stats;
  traits: string[];
}

export type Doctrine =
  /** Textbook: everyone advances in formation. */
  | { kind: "advance" }
  /** Ambush: hold position until an enemy comes within `radius` or the squad is hit. */
  | { kind: "hold"; radius: number }
  /** Hunt: strongly prefer targets with a class tag (healer, caster...). */
  | { kind: "hunt"; tag: string }
  /** Packs: circle and pick off isolated stragglers. */
  | { kind: "pack" };

export interface ScenarioUnit {
  unitId: string;
  side: Side;
  pos: Pos;
}

export interface ScenarioDef {
  id: string;
  name: string;
  description: string;
  /**
   * ASCII map, one string per row.
   *   .  floor     #  wall (blocks movement and sight)
   *   ~  swamp (x2 move cost)     "  thicket (x1.5 move cost, blocks sight)
   *   O  bottomless pit (no footing, doesn't block sight)
   */
  map: string[];
  /**
   * Optional ground height per tile in metres (digits), same shape as `map`.
   * 1 m steps are climbable; 2 m needs a jumper; melee only connects across 1 m
   * (spears 2 m); ranged gets high-ground bonuses.
   */
  heights?: string[];
  /** Where the player may place units (inclusive rectangle). */
  deployZone: { x0: number; y0: number; x1: number; y1: number };
  units: ScenarioUnit[];
  doctrine: Doctrine;
  /** Difficulty knob: an extra modifier layer applied to every enemy (e.g. +20% hp). */
  enemyMods?: Modifier[];
  /** Fire Emblem-style scouting readout: a general picture, not every detail. */
  scouting: string;
}

export interface Content {
  races: Record<string, RaceDef>;
  classes: Record<string, ClassDef>;
  weapons: Record<string, WeaponDef>;
  trinkets: Record<string, TrinketDef>;
  statuses: Record<string, StatusDef>;
  abilities: Record<string, AbilityDef>;
  passives: Record<string, PassiveDef>;
  traits: Record<string, TraitDef>;
  units: Record<string, UnitDef>;
  scenarios: Record<string, ScenarioDef>;
  /** Default speech lines per reason, used when traits don't override. */
  voice: Partial<Record<Reason, string[]>>;
}

// ---------------------------------------------------------------- runtime

export interface ActiveStatus {
  def: StatusDef;
  expiresAt: number;
  nextPulse: number;
  sourceUid: number;
}

export interface Unit {
  /** Stable index in BattleState.units; also the final tie-breaker. */
  uid: number;
  defId: string;
  name: string;
  side: Side;
  race: RaceDef;
  cls: ClassDef;
  weapon: WeaponDef;
  /** Usable actives, basic attack first. */
  abilities: AbilityDef[];
  passives: PassiveDef[];
  traits: TraitDef[];
  weights: Weights;
  /** Personal stats + race bonus: the bottom layer of the modifier stack. */
  base: Stats;
  /** Class, gear and passive modifiers. Statuses add theirs on top. */
  staticMods: Modifier[];
  /** Modifiers from the battle situation (e.g. underdog), recomputed as it changes. */
  situationalMods: Modifier[];
  statuses: ActiveStatus[];
  buildup: Record<string, number>;
  /** Ability id -> tick when it's ready again. */
  cooldowns: Record<string, number>;
  /** Passive ids that already fired (for `once`). */
  firedOnce: Set<string>;
  hpFlags: { below50: boolean; below25: boolean };
  pos: Pos;
  hp: number;
  gauge: number;
  alive: boolean;
  /** Set by the commander layer each turn. */
  intent: "engage" | "hold";
  lastReason: Reason | null;
  /** AI commitment: uid of the enemy this unit is working on (rules.commitTarget). */
  committed: number | null;
  /** AI commitment: a multi-step move in progress (rules.stride). */
  plan: { dest: Pos; steps: number; hp: number; reason: Reason } | null;
  /** The tile this unit last stepped off, and its HP then (rules.advance: no ping-ponging). Cleared by holding. */
  lastStep: { from: Pos; hp: number } | null;
  /**
   * Commitment (rules.commit): the tactic this unit is sticking with for a few steps.
   * engage = closing on `target`; reposition = backing away from the enemy.
   */
  posture: { kind: "engage" | "reposition"; steps: number; hp: number; target: number | null } | null;
  /** Retreat clock (rules.retreatLimit): ticks spent backing off or holding since it last acted. */
  evasion: number;
  /** When this unit's previous turn was, and whether it backed off or held. */
  lastTurn: { t: number; evasive: boolean } | null;
  /** Bounded-luck meters per roll stage (rules.luck = "meter"). */
  meters: Record<string, number>;
  /** Consecutive turns spent holding. Impatience: waiting erodes caution so standoffs break. */
  idle: number;
  /** Modifier-stack cache, cleared whenever statuses change. */
  cache: Map<ModKey, number>;
}
