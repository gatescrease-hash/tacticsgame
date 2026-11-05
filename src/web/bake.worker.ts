/// <reference lib="webworker" />
/**
 * Bakes battles off the main thread. Results are settled: the setup is
 * simulated across sample seeds, the difficulty settles the result, and the log
 * of a battle that produced it goes back. Nothing is decided while the player watches.
 */
import { content } from "../content/index.js";
import { fight, type BattleRecord, type RunState } from "../run/run.js";
import { settleBattle, type BattleLog, type BattleOptions, type Difficulty, type Pos } from "../sim/index.js";

export type BakeRequest =
  | { kind: "single"; scenario: string; seed: number; difficulty: Difficulty; opts: BattleOptions }
  | { kind: "run"; run: RunState; deployed: string[]; anchor: Pos | null; seed: number };

export interface BakeResponse {
  log: BattleLog;
  winner: string;
  ms: number;
  winProb: number;
  samples: number;
  margin: number;
  /** Run fights only: the result to apply to the run. */
  record?: BattleRecord;
}

self.onmessage = (ev: MessageEvent<BakeRequest>) => {
  const req = ev.data;
  const t0 = performance.now();
  let res: BakeResponse;
  if (req.kind === "single") {
    const r = settleBattle(content, req.scenario, req.seed, { ...req.opts, recordQueue: true }, { difficulty: req.difficulty });
    res = { log: r.result.log, winner: r.result.winner, ms: 0, winProb: r.winProb, samples: r.samples, margin: r.margin };
  } else {
    const { settle, record } = fight(content, req.run, req.deployed, req.anchor ?? undefined, req.seed, { recordQueue: true });
    res = { log: settle.result.log, winner: settle.result.winner, ms: 0, winProb: settle.winProb, samples: settle.samples, margin: settle.margin, record };
  }
  res.ms = performance.now() - t0;
  self.postMessage(res);
};
