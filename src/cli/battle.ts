/**
 * Run one battle and print its text log.
 *   npm run battle -- [scenario] [seed] [--debug] [--settle easy|normal|hard]
 * --debug also prints the AI's top candidate scores for every decision.
 * --settle simulates the setup across sample seeds, settles the result for that
 *   difficulty, and shows a battle that produced it (see src/sim/settle.ts).
 */
import { content, scenarioIds } from "../content/index.js";
import { formatLog, runBattle, settleBattle, validateContent, type Difficulty } from "../sim/index.js";

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const sIdx = args.indexOf("--settle");
const settle = sIdx >= 0 ? (args[sIdx + 1] as Difficulty) : null;
const [scenario = "duel", seedArg = "1"] = args.filter((a, i) => !a.startsWith("--") && (sIdx < 0 || i !== sIdx + 1));

const problems = validateContent(content);
if (problems.length) {
  console.error("Content problems:\n  " + problems.join("\n  "));
  process.exit(1);
}
if (!content.scenarios[scenario]) {
  console.error(`Unknown scenario '${scenario}'. Available: ${scenarioIds.join(", ")}`);
  process.exit(1);
}
if (settle) {
  const r = settleBattle(content, scenario, Number(seedArg), { debug }, { difficulty: settle });
  console.log(`Settled (${settle}): player won ${r.winProb}% of ${r.samples} sample battles -> ${r.settled} wins; showing sample seed ${r.seed} (margin ${r.margin}%)`);
  for (const line of formatLog(r.result.log, { debug })) console.log(line);
} else {
  const result = runBattle(content, scenario, Number(seedArg), { debug });
  for (const line of formatLog(result.log, { debug })) console.log(line);
}
