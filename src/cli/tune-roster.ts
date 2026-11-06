/**
 * Settled win % for a fresh run's default deployment (starting roster, level 1, default spot)
 * in each encounter, at a few enemy strengths. Scenario `power` is tuned against this.
 *   npm run tune-roster -- [skirmish,patrol,...] [0,15,30]
 */
import { content } from "../content/index.js";
import { settleBattle } from "../sim/index.js";
import { DEFAULT_RUN, currentEncounter, defaultDeployment, newRun, unitMods } from "../run/run.js";

const ids = process.argv[2] ? process.argv[2].split(",") : DEFAULT_RUN.encounters;
const powers = (process.argv[3] ?? "0,15,30").split(",").map(Number);
for (const id of ids) {
  const run = newRun(1);
  run.order = [id];
  const enc = currentEncounter(content, run);
  const deployed = defaultDeployment(run, enc.slots);
  const roster = deployed.map((u) => ({ unitId: u, mods: unitMods(content, run.roster.find((r) => r.unitId === u)!), trinkets: [] }));
  const ps = powers.map((p) => settleBattle(content, id, 1, { roster, enemyPower: p }).winProb);
  console.log(`${id.padEnd(9)} [${deployed.join(",")}]  ` + powers.map((p, i) => `+${p}%: ${ps[i]}`).join("  "));
}
