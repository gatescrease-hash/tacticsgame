/// <reference lib="webworker" />
/**
 * Bakes a battle off the main thread: the whole fight is simulated here and
 * only the log goes back. Nothing is decided while the player watches.
 */
import { content } from "../content/index.js";
import { runBattle, type BattleOptions } from "../sim/index.js";

export interface BakeRequest {
  scenario: string;
  seed: number;
  opts: BattleOptions;
}

self.onmessage = (ev: MessageEvent<BakeRequest>) => {
  const { scenario, seed, opts } = ev.data;
  const t0 = performance.now();
  const result = runBattle(content, scenario, seed, { ...opts, recordQueue: true });
  self.postMessage({ log: result.log, winner: result.winner, ms: performance.now() - t0 });
};
