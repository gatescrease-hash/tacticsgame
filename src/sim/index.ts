/**
 * Public API of the simulation. Pure TypeScript: no DOM, no Node APIs
 * (enforced by tsconfig.sim.json). Runs in the browser, a web worker, or Node.
 */
export * from "./types.js";
export * from "./log.js";
export { Rng } from "./rng.js";
export { Grid, manhattan } from "./grid.js";
export { runBattle, setupBattle, type BattleResult, type BattleState, type BattleOptions } from "./battle.js";
export { formatLog } from "./format.js";
export { hitChance, dodgeChance, parryChance, critChance, packetDamage, resolveAttack } from "./combat.js";
