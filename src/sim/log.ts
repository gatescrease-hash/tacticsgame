import type { Pos, Side } from "./types.js";

/**
 * The battle log is the simulation's only output. Playback, speech bubbles,
 * stats and debugging all read it; the simulation never talks to graphics.
 */

export type AttackOutcome = "missed" | "dodged" | "parried" | "glanced off" | "hit";

export interface UnitSnapshot {
  uid: number;
  name: string;
  className: string;
  side: Side;
  pos: Pos;
  hp: number;
  maxHp: number;
}

export type BattleEvent =
  | { t: number; kind: "start"; scenario: string; seed: number; width: number; height: number; map: string[]; units: UnitSnapshot[] }
  | { t: number; kind: "move"; uid: number; from: Pos; to: Pos; cost: number }
  | {
      t: number;
      kind: "attack";
      uid: number;
      target: number;
      outcome: AttackOutcome;
      crit: boolean;
      damage: number;
      hpAfter: number;
      cost: number;
    }
  | { t: number; kind: "wait"; uid: number; cost: number }
  | { t: number; kind: "knockout"; uid: number; by: number }
  | { t: number; kind: "end"; winner: Side | "draw"; reason: string };

export type BattleLog = BattleEvent[];
