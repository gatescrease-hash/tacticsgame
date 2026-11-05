/**
 * Roguelike run model: how long does a run last, and how do losses arrive?
 *
 * Settled outcomes are deterministic per setup, so the expensive part is
 * precomputed once into a table, then runs are simulated instantly from it:
 *
 *   npm run runs -- table <scenario> [setups]   # sample battles -> runs-cache/<scenario>.json
 *   npm run runs -- model [--runs 2000] [--ramp 1] [--hearts 5]
 *
 * Table: for each enemy strength level (+0%..+50%) and play style, K setups,
 * each sampled across the settle seeds (win/loss margins kept).
 * Model: a run visits the scenarios in shuffled order with enemy strength
 * ramping by --ramp % per battle (net of whatever the player gains). Each
 * battle settles by difficulty; a loss costs hearts by how badly it went
 * (TFT-style), and the run ends at 0 hearts.
 *
 * Play styles:
 *   typical    full roster, squad dropped at a random spot in the deploy zone
 *   careless   one or two random units benched, random spot
 *   thoughtful the best of the typical setups for that fight (by win rate)
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { content } from "../content/index.js";
import { DIFFICULTIES, Rng, sampleSetup, type Difficulty, type Pos } from "../sim/index.js";

const CACHE = "runs-cache";
const LEVELS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const SCENARIOS = ["skirmish", "patrol", "foundry", "marsh", "wolves"];

interface SetupResult {
  /** Player win % across samples. */
  p: number;
  /** Winner's remaining HP % for each sampled win / loss, sorted ascending. */
  winMargins: number[];
  lossMargins: number[];
}
interface Table {
  scenario: string;
  levels: number[];
  /** style -> level index -> setups */
  styles: Record<"typical" | "careless", SetupResult[][]>;
}

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : dflt;
};

function randomSetup(id: string, k: number, careless: boolean): { placements: Record<number, Pos>; benched: number[] } {
  const sc = content.scenarios[id]!;
  const rng = new Rng(k * 104729 + (careless ? 7 : 3));
  const z = sc.deployZone;
  const free: Pos[] = [];
  for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) if (sc.map[y]?.[x] !== "#") free.push({ x, y });
  const anchor = free[rng.int(free.length)]!;
  const players = sc.units.flatMap((u, i) => (u.side === "player" ? [i] : []));
  const placements: Record<number, Pos> = {};
  for (const i of players) placements[i] = { ...anchor };
  const benched: number[] = [];
  if (careless) {
    const n = Math.min(players.length - 1, 1 + rng.int(2));
    const pool = [...players];
    for (let j = 0; j < n; j++) benched.push(pool.splice(rng.int(pool.length), 1)[0]!);
  }
  return { placements, benched };
}

function buildTable(id: string, setups: number): void {
  const styles: Table["styles"] = { typical: [], careless: [] };
  for (const style of ["typical", "careless"] as const) {
    for (const enemyPower of LEVELS) {
      const row: SetupResult[] = [];
      for (let k = 0; k < setups; k++) {
        const samples = sampleSetup(content, id, { ...randomSetup(id, k, style === "careless"), enemyPower });
        const wins = samples.filter((x) => x.winner === "player");
        const losses = samples.filter((x) => x.winner !== "player");
        row.push({
          p: Math.round((100 * wins.length) / samples.length),
          winMargins: wins.map((x) => x.margin).sort((a, b) => a - b),
          lossMargins: losses.map((x) => x.margin).sort((a, b) => a - b),
        });
      }
      styles[style].push(row);
    }
  }
  mkdirSync(CACHE, { recursive: true });
  const table: Table = { scenario: id, levels: LEVELS, styles };
  writeFileSync(`${CACHE}/${id}.json`, JSON.stringify(table));
  console.log(`wrote ${CACHE}/${id}.json`);
}

/** Hearts lost for a loss, by the enemy's remaining HP %: a narrow loss costs 1, a rout 3. */
function heartsLost(enemyMargin: number): number {
  return enemyMargin < 35 ? 1 : enemyMargin < 70 ? 2 : 3;
}

function model(): void {
  const tables = readdirSync(CACHE).map((f) => JSON.parse(readFileSync(`${CACHE}/${f}`, "utf8")) as Table);
  const runs = Number(flag("runs", "2000"));
  const ramp = Number(flag("ramp", "1"));
  const hearts = Number(flag("hearts", "5"));
  const maxBattles = 60;
  console.log(`run model: ${tables.length} scenarios, ramp +${ramp}% enemy strength per battle, ${hearts} hearts, ${runs} runs per cell`);
  console.log(`cells: median battles survived [10th-90th pct], battle win %, % of runs reaching battle 15`);

  for (const difficulty of Object.keys(DIFFICULTIES) as Difficulty[]) {
    const diff = DIFFICULTIES[difficulty];
    const cells: string[] = [];
    for (const style of ["careless", "typical", "thoughtful"] as const) {
      const rng = new Rng(12345);
      const lengths: number[] = [];
      let battles = 0;
      let wins = 0;
      for (let r = 0; r < runs; r++) {
        let hp = hearts;
        let i = 0;
        const order = [...tables];
        while (hp > 0 && i < maxBattles) {
          if (i % order.length === 0) {
            for (let j = order.length - 1; j > 0; j--) {
              const k = rng.int(j + 1);
              [order[j], order[k]] = [order[k]!, order[j]!];
            }
          }
          const t = order[i % order.length]!;
          const lvl = Math.min(t.levels.length - 1, Math.round((ramp * i) / 5));
          const pool = style === "careless" ? t.styles.careless[lvl]! : t.styles.typical[lvl]!;
          const setup = style === "thoughtful" ? pool.reduce((a, b) => (b.p > a.p ? b : a)) : pool[rng.int(pool.length)]!;
          battles++;
          if (setup.p >= diff.threshold) {
            wins++;
          } else {
            const m = setup.lossMargins;
            const enemyMargin = m.length ? m[Math.round(((m.length - 1) * diff.marginPercentile) / 100)]! : 50;
            hp -= heartsLost(enemyMargin);
          }
          i++;
        }
        lengths.push(i);
      }
      lengths.sort((a, b) => a - b);
      const q = (f: number) => lengths[Math.floor(f * (lengths.length - 1))]!;
      const reach15 = (100 * lengths.filter((l) => l >= 15).length) / runs;
      cells.push(`${style.padEnd(10)} ${String(q(0.5)).padStart(2)} [${q(0.1)}-${q(0.9)}] ${((100 * wins) / battles).toFixed(0).padStart(3)}% ${reach15.toFixed(0).padStart(3)}%`);
    }
    console.log(`\n${difficulty}`);
    for (const c of cells) console.log(`  ${c}`);
  }
}

const [cmd, arg] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1]!.startsWith("--")));
if (cmd === "table") {
  if (!arg || !content.scenarios[arg]) throw new Error(`usage: runs table <scenario> [setups]; scenarios: ${SCENARIOS.join(", ")}`);
  buildTable(arg, Number(args[2] ?? "6"));
} else {
  model();
}
