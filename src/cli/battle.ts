/**
 * Run one battle and print its text log.
 *   npm run battle -- [scenario] [seed] [--debug]
 * --debug also prints the AI's top candidate scores for every decision.
 */
import { content, scenarioIds } from "../content/index.js";
import { formatLog, runBattle, validateContent } from "../sim/index.js";

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const [scenario = "duel", seedArg = "1"] = args.filter((a) => !a.startsWith("--"));

const problems = validateContent(content);
if (problems.length) {
  console.error("Content problems:\n  " + problems.join("\n  "));
  process.exit(1);
}
if (!content.scenarios[scenario]) {
  console.error(`Unknown scenario '${scenario}'. Available: ${scenarioIds.join(", ")}`);
  process.exit(1);
}
const result = runBattle(content, scenario, Number(seedArg), { debug });
for (const line of formatLog(result.log, { debug })) console.log(line);
