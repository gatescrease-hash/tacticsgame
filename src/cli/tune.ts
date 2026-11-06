/**
 * Scenario tuning helper: median settled win % (over random placements) as the enemy's
 * power shifts. Use it to retune a scenario's `power` after rule or AI changes.
 *   npm run tune -- <scenario> [--offsets -20,-10,0,10,20] [--placements 10]
 */
import { content } from "../content/index.js";
import { Rng, settleBattle, type Pos, type ScenarioDef } from "../sim/index.js";

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : dflt;
};
const id = args[0]!;
const sc = content.scenarios[id];
if (!sc) throw new Error(`unknown scenario ${id}`);
const offsets = flag("offsets", "-20,-10,0,10,20").split(",").map(Number);
const P = Number(flag("placements", "10"));

/** A random spot in the deploy zone for the squad to form up around (as a player would drop it). */
function randomAnchor(s: ScenarioDef, k: number): Pos {
  const rng = new Rng(k * 7919 + 13);
  const z = s.deployZone;
  const free: Pos[] = [];
  for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (s.map[y]?.[x] !== "#") free.push({ x, y });
  return free[rng.int(free.length)]!;
}

for (const off of offsets) {
  const probs: number[] = [];
  for (let k = 0; k < P; k++) {
    const a = randomAnchor(sc, k);
    const placements: Record<number, Pos> = {};
    sc.units.forEach((u, i) => { if (u.side === "player") placements[i] = a; });
    probs.push(settleBattle(content, id, 1, { placements, enemyPower: off }).winProb);
  }
  probs.sort((a, b) => a - b);
  console.log(`${id} power ${off >= 0 ? "+" : ""}${off}: median ${probs[Math.floor(P / 2)]}  range ${probs[0]}-${probs[P - 1]}`);
}
