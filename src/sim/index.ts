/**
 * Public API of the simulation. Pure TypeScript: no DOM, no Node APIs
 * (enforced by tsconfig.sim.json). Runs in the browser, a web worker, or Node.
 */
export * from "./types.js";
export * from "./log.js";
export { Rng } from "./rng.js";
export { Grid, manhattan, hasLineOfSight } from "./grid.js";
export { runBattle, setupBattle, createUnit, previewTurnOrder, snapshot, type BattleResult } from "./battle.js";
export type { BattleOptions, BattleState } from "./state.js";
export { formatLog, describeEvent } from "./format.js";
export { validateContent } from "./validate.js";
export { stat, maxHp } from "./stats.js";
export { computePacket, tierFor, pillarOf } from "./damage.js";
export { stageChances, landChance, critChance, basicAttack } from "./combat.js";
