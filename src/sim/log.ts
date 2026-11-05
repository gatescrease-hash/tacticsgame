import type { DamageType, Element, Pos, Reason, Side, Tier } from "./types.js";

/**
 * The battle log is the simulation's only output. Playback, speech bubbles,
 * batch stats and debugging all read it; the simulation never talks to graphics.
 */

export type AttackOutcome = "missed" | "dodged" | "parried" | "blocked" | "glanced off" | "hit";

export interface UnitSnapshot {
  uid: number;
  name: string;
  className: string;
  raceName: string;
  /** Content ids, so renderers can pick a model. */
  classId: string;
  raceId: string;
  weaponId: string;
  side: Side;
  pos: Pos;
  hp: number;
  maxHp: number;
  traits: string[];
}

export interface ComponentResult {
  type: DamageType;
  element?: Element;
  tier: Tier;
  damage: number;
}

export interface CandidateDebug {
  label: string;
  score: number;
  parts: Record<string, number>;
}

export type BattleEvent =
  | {
      t: number;
      kind: "start";
      scenario: string;
      seed: number;
      width: number;
      height: number;
      map: string[];
      units: UnitSnapshot[];
    }
  /** A unit begins its turn. `queue` = projected upcoming actors (for the turn-order bar). */
  | { t: number; kind: "turn"; uid: number; queue?: number[] }
  | { t: number; kind: "move"; uid: number; from: Pos; to: Pos; cost: number }
  | { t: number; kind: "ability"; uid: number; ability: string; abilityName: string; target: number; at: Pos; cost: number; counter: boolean }
  | {
      t: number;
      kind: "hit";
      uid: number;
      target: number;
      ability: string;
      outcome: AttackOutcome;
      crit: boolean;
      components: ComponentResult[];
      damage: number;
      hpAfter: number;
      /** Cross-element interaction that fired, e.g. "conducted", "spread". */
      interaction?: string;
    }
  | { t: number; kind: "heal"; uid: number; target: number; amount: number; hpAfter: number }
  | { t: number; kind: "dot"; uid: number; status: string; damage: number; hpAfter: number }
  | { t: number; kind: "status"; uid: number; status: string; statusName: string; short: string; on: boolean }
  | { t: number; kind: "gauge"; uid: number; target: number; amount: number }
  | { t: number; kind: "push"; uid: number; from: Pos; to: Pos }
  | { t: number; kind: "say"; uid: number; text: string; reason: Reason }
  | { t: number; kind: "wait"; uid: number; cost: number }
  | { t: number; kind: "knockout"; uid: number; by: number }
  /** Debug only (BattleOptions.debug): the AI's top candidates and why. */
  | { t: number; kind: "decide"; uid: number; chosen: string; candidates: CandidateDebug[] }
  | { t: number; kind: "end"; winner: Side | "draw"; reason: string };

export type BattleLog = BattleEvent[];
