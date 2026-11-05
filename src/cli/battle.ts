/**
 * Run one battle and print its text log.
 *   npm run battle -- [scenario] [seed]
 */
import { content, scenarioIds } from "../content/index.js";
import { formatLog, runBattle } from "../sim/index.js";

const [scenario = "duel", seedArg = "1"] = process.argv.slice(2);
if (!content.scenarios[scenario]) {
  console.error(`Unknown scenario '${scenario}'. Available: ${scenarioIds.join(", ")}`);
  process.exit(1);
}
const result = runBattle(content, scenario, Number(seedArg));
for (const line of formatLog(result.log)) console.log(line);
