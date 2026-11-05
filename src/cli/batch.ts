/**
 * Headless batch runner: play a scenario across many seeds and report win
 * rates, battle length, damage share, ability usage and tempo sensitivity.
 *   npm run batch -- [scenario|all] [runs] [--jitter N]
 * The seed for run i is i, so any run can be replayed with `npm run battle -- <scenario> <i>`.
 */
import { content, scenarioIds } from "../content/index.js";
import { runBattle, validateContent } from "../sim/index.js";
import { summarize } from "../tools/stats.js";

const args = process.argv.slice(2);
const jIdx = args.indexOf("--jitter");
const jitter = jIdx >= 0 ? Number(args[jIdx + 1]) : 20;
const positional = args.filter((a, i) => !a.startsWith("--") && (jIdx < 0 || i !== jIdx + 1));
const [which = "all", runsArg = "500"] = positional;
const runs = Number(runsArg);

const problems = validateContent(content);
if (problems.length) {
  console.error("Content problems:\n  " + problems.join("\n  "));
  process.exit(1);
}
const targets = which === "all" ? scenarioIds : [which];
for (const id of targets) {
  if (!content.scenarios[id]) {
    console.error(`Unknown scenario '${id}'. Available: ${scenarioIds.join(", ")}`);
    process.exit(1);
  }
  const t0 = performance.now();
  const results = [];
  for (let seed = 1; seed <= runs; seed++) results.push(runBattle(content, id, seed));
  const ms = performance.now() - t0;
  // Tempo sensitivity: same seeds, perturbed opening gauges. How often does the winner flip?
  let flips = 0;
  for (let seed = 1; seed <= runs; seed++) {
    if (runBattle(content, id, seed, { gaugeJitter: jitter }).winner !== results[seed - 1]!.winner) flips++;
  }
  console.log(summarize(id, results, ms, { flips, jitter }));
  console.log();
}
