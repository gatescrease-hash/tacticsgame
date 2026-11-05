/// <reference lib="webworker" />
/**
 * Bakes a battle off the main thread. The setup is simulated across sample
 * seeds, the result is settled for the chosen difficulty, and the log of a
 * battle that produced it goes back. Nothing is decided while the player watches.
 */
import { content } from "../content/index.js";
import { settleBattle, type BattleOptions, type Difficulty } from "../sim/index.js";

export interface BakeRequest {
  scenario: string;
  seed: number;
  difficulty: Difficulty;
  opts: BattleOptions;
}

self.onmessage = (ev: MessageEvent<BakeRequest>) => {
  const { scenario, seed, difficulty, opts } = ev.data;
  const t0 = performance.now();
  const r = settleBattle(content, scenario, seed, { ...opts, recordQueue: true }, { difficulty });
  self.postMessage({ log: r.result.log, winner: r.result.winner, ms: performance.now() - t0, winProb: r.winProb, samples: r.samples, margin: r.margin });
};
