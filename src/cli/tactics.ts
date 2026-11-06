/**
 * Do tactics pay off? Player win % per scenario as enemy power rises, with the player
 * squad brawling (tactics 0), at its natural tactics, and trained (+bonus). Smarter
 * play should win more at every strength. Seeds 1..runs; the enemy keeps its own tactics.
 *   npm run tactics -- [scenario|all] [runs=40] [--levels 0,15,30] [--bonus 60] [--rules '{json}']
 */
import { content, scenarioIds } from "../content/index.js";
import { runBattle, type Rules } from "../sim/index.js";

const argv = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1]! : dflt;
};
const pos = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1]!.startsWith("--")));
const [which = "all", runsArg = "40"] = pos;
const runs = Number(runsArg);
const levels = flag("levels", "0,15,30").split(",").map(Number);
const bonus = Number(flag("bonus", "60"));
const base = JSON.parse(flag("rules", "{}")) as Partial<Rules>;
const ids = which === "all" ? scenarioIds.filter((id) => id !== "duel") : [which];

const variants: [string, Partial<Rules>][] = [
  ["brawl", { playerTactics: -100 }],
  ["natural", {}],
  [`+${bonus}`, { playerTactics: bonus }],
];
console.log(`player win % at enemy power ${levels.map((l) => `+${l}%`).join(" / ")}, ${runs} seeds each`);
for (const id of ids) {
  const cells = variants.map(([name, r]) => {
    const ws = levels.map((enemyPower) => {
      let w = 0;
      for (let seed = 1; seed <= runs; seed++) if (runBattle(content, id, seed, { rules: { ...base, ...r }, enemyPower }).winner === "player") w++;
      return Math.round((100 * w) / runs);
    });
    return `${name} ${ws.map((x) => String(x).padStart(3)).join(" ")}`;
  });
  console.log(`${id.padEnd(9)} ${cells.join("   ")}`);
}
