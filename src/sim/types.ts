/**
 * Core simulation types. Content (src/content) is plain data shaped by these;
 * runtime state is created from content by the battle setup.
 */

export type Side = "player" | "enemy";

export interface Pos {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- stats

/** Each stat has one job no other stat does (see design notes, "Stats and growth"). */
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

// ---------------------------------------------------------------- damage

export type PhysicalType = "slashing" | "piercing" | "bludgeoning";
/** Pillar damage types are reserved for later; only physical is resolved today. */
export type DamageType = PhysicalType | "fire" | "lightning" | "psychic" | "spirit";

export type ArmourMaterial = "cloth" | "leather" | "chain" | "plate" | "stone";

/** One component of a hit's damage packet, as a share (percent) of the hit's power. */
export interface PacketComponent {
  type: DamageType;
  share: number;
}

// ---------------------------------------------------------------- content defs

export interface WeaponDef {
  id: string;
  name: string;
  packet: PacketComponent[];
  might: number;
  accuracy: number;
  /** Gauge cost of one attack. Big moves delay the next turn. */
  cost: number;
  range: { min: number; max: number };
  canParry: boolean;
  ignoresParry: boolean;
}

export interface ClassDef {
  id: string;
  name: string;
  /** Armour is class identity, not a swappable item. */
  armour: { material: ArmourMaterial; value: number };
  /** Gauge cost per tile moved. */
  moveCost: number;
  /** Flat bonus (or penalty) for being in the class. */
  baseBonus: Partial<Stats>;
  weaponTypes: string[];
}

export interface UnitDef {
  id: string;
  name: string;
  classId: string;
  weaponId: string;
  /** Personal stats. */
  stats: Stats;
  traits: string[];
}

export interface ScenarioUnit {
  unitId: string;
  side: Side;
  pos: Pos;
}

export interface ScenarioDef {
  id: string;
  name: string;
  /**
   * ASCII map, one string per row.
   *   .  floor
   *   #  blocked (also blocks sight)
   *   ~  swamp (doubles movement cost)
   */
  map: string[];
  units: ScenarioUnit[];
}

export interface Content {
  classes: Record<string, ClassDef>;
  weapons: Record<string, WeaponDef>;
  units: Record<string, UnitDef>;
  scenarios: Record<string, ScenarioDef>;
}

// ---------------------------------------------------------------- runtime

export interface Unit {
  /** Stable index in BattleState.units; also the final tie-breaker. */
  uid: number;
  defId: string;
  name: string;
  side: Side;
  cls: ClassDef;
  weapon: WeaponDef;
  /** Displayed stats (personal + class bonus). The modifier stack will replace this. */
  stats: Stats;
  traits: string[];
  pos: Pos;
  hp: number;
  gauge: number;
  alive: boolean;
}
