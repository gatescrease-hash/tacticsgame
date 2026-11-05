/**
 * Robustness report: is the outcome decided by *what* you bring, not by exactly
 * where you dropped it or by the dice?
 *   npm run robustness -- [--placements 10] [--seeds 10] [--presets a,b]
 *
 * For each scenario it samples random player placements inside the deploy zone,
 * and several seeds per placement:
 *  - win%    overall player win rate.
 *  - placeSD standard deviation of per-placement win rates. How much exact
 *            placement matters. Lower is better.
 *  - coin%   average of 4p(1-p) over placements: 0 when each placement has a
 *            fixed result, 100 when every placement is a coin flip on the seed.
 *            How much the dice matter. Lower is better.
 * Mirror fixtures (m2, m3, m5: identical squads on both sides of an open,
 * symmetric map, enemy advancing) also report win% with the enemy at +15% and
 * +30% power: parity should go to the player, a clearly stronger enemy shouldn't.
 */
import { content } from "../content/index.js";
import { DEFAULT_RULES, Rng, runBattle, type Content, type Pos, type Rules, type ScenarioDef } from "../sim/index.js";

const F = { formation: true };
export const PRESETS: Record<string, Partial<Rules>> = {
  current: DEFAULT_RULES,
  formation: F,
  "f+dice2": { ...F, hitDice: 2 },
  "f+dice3": { ...F, hitDice: 3 },
  "f+meter": { ...F, luck: "meter" },
  "f+focus": { ...F, focusFire: true },
  "f+meter+focus": { ...F, luck: "meter", focusFire: true },
  "f+meter+focus-spread": { ...F, luck: "meter", focusFire: true, damageSpread: 0 },
  "f+meter+focus+hold-charge": { ...F, luck: "meter", focusFire: true, playerHold: 3, charge: false },
  "f+meter+focus+fixedluck": { ...F, luck: "meter", focusFire: true, seededLuck: false, damageSpread: 0 },
  "f+meter+focus+hp300": { ...F, luck: "meter", focusFire: true, hpScale: 300 },
  // AI commitment (B = formation + meter luck + focus fire). "fix" = luck fixed, no spread: no randomness at all.
  B: { ...F, luck: "meter", focusFire: true },
  "B+commit": { ...F, luck: "meter", focusFire: true, commitTarget: true },
  "B+stride3": { ...F, luck: "meter", focusFire: true, stride: 3 },
  "B+cohesion": { ...F, luck: "meter", focusFire: true, cohesion: 10 },
  "B+all": { ...F, luck: "meter", focusFire: true, commitTarget: true, stride: 3, cohesion: 10 },
  "B+all6": { ...F, luck: "meter", focusFire: true, commitTarget: true, stride: 6, cohesion: 10 },
  "B fix": { ...F, luck: "meter", focusFire: true, seededLuck: false, damageSpread: 0 },
  "B+commit fix": { ...F, luck: "meter", focusFire: true, seededLuck: false, damageSpread: 0, commitTarget: true },
  "B+stride3 fix": { ...F, luck: "meter", focusFire: true, seededLuck: false, damageSpread: 0, stride: 3 },
  "B+cohesion fix": { ...F, luck: "meter", focusFire: true, seededLuck: false, damageSpread: 0, cohesion: 10 },
  "B+all fix": { ...F, luck: "meter", focusFire: true, seededLuck: false, damageSpread: 0, commitTarget: true, stride: 3, cohesion: 10 },
  "B+all6 fix": { ...F, luck: "meter", focusFire: true, seededLuck: false, damageSpread: 0, commitTarget: true, stride: 6, cohesion: 10 },
  "f+meter+focus+ud25": { ...F, luck: "meter", focusFire: true, underdog: 25 },
  "f+meter+focus+hold-charge+ud25": { ...F, luck: "meter", focusFire: true, playerHold: 3, charge: false, underdog: 25 },
};

const MIRROR_MAP = [
  "............",
  "............",
  "....#..#....",
  "............",
  "............",
  "....#..#....",
  "............",
  "............",
];

function mirror(id: string, team: string[]): ScenarioDef {
  const ys = team.map((_, i) => 2 + i);
  return {
    id,
    name: id,
    description: "mirror fixture",
    scouting: "",
    map: MIRROR_MAP,
    deployZone: { x0: 0, y0: 0, x1: 2, y1: 7 },
    units: [
      ...team.map((unitId, i) => ({ unitId, side: "player" as const, pos: { x: 1, y: ys[i]! } })),
      ...team.map((unitId, i) => ({ unitId, side: "enemy" as const, pos: { x: 10, y: ys[i]! } })),
    ],
    doctrine: { kind: "advance" },
  };
}

const MIRRORS = {
  m2: mirror("m2", ["aldric", "vex"]),
  m3: mirror("m3", ["aldric", "wren", "oswin"]),
  m5: mirror("m5", ["aldric", "kesh", "wren", "sela", "oswin"]),
};
const world: Content = { ...content, scenarios: { ...content.scenarios, ...MIRRORS } };

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : dflt;
};
const P = Number(flag("placements", "10"));
const S = Number(flag("seeds", "10"));
const presets = flag("presets", Object.keys(PRESETS).join(",")).split(",");
const real = ["skirmish", "patrol", "foundry", "marsh", "wolves"];

/** A random legal placement of the player's units inside the deploy zone. */
function randomPlacement(sc: ScenarioDef, k: number): Record<number, Pos> {
  const rng = new Rng(k * 7919 + 13);
  const z = sc.deployZone;
  const free: Pos[] = [];
  for (let y = z.y0; y <= z.y1; y++) {
    for (let x = z.x0; x <= z.x1; x++) {
      if (sc.map[y]?.[x] === "#" || sc.units.some((u) => u.side === "enemy" && u.pos.x === x && u.pos.y === y)) continue;
      free.push({ x, y });
    }
  }
  const out: Record<number, Pos> = {};
  sc.units.forEach((u, i) => {
    if (u.side !== "player") return;
    out[i] = free.splice(rng.int(free.length), 1)[0]!;
  });
  return out;
}

function measure(id: string, rules: Partial<Rules>, enemyPower = 0) {
  const sc = world.scenarios[id]!;
  const perPlacement: number[] = [];
  for (let k = 0; k < P; k++) {
    const placements = randomPlacement(sc, k);
    let w = 0;
    for (let seed = 1; seed <= S; seed++) if (runBattle(world, id, seed, { rules, placements, enemyPower }).winner === "player") w++;
    perPlacement.push(w / S);
  }
  const mean = perPlacement.reduce((a, b) => a + b, 0) / P;
  const sd = Math.sqrt(perPlacement.reduce((a, p) => a + (p - mean) ** 2, 0) / P);
  const coin = perPlacement.reduce((a, p) => a + 4 * p * (1 - p), 0) / P;
  return { win: 100 * mean, sd: 100 * sd, coin: 100 * coin };
}

const f = (v: number) => v.toFixed(0).padStart(4);

/** Enemy power (%) at which a decreasing win% curve crosses `target`, by linear interpolation. */
function crossing(levels: number[], curve: number[], target: number): number {
  if (curve[0]! < target) return levels[0]!;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i]! <= target) {
      const a = curve[i - 1]!;
      const b = curve[i]!;
      return levels[i - 1]! + ((a - target) / Math.max(1e-9, a - b)) * (levels[i]! - levels[i - 1]!);
    }
  }
  return levels.at(-1)!;
}

if (args.includes("--curve")) {
  // Mirror strength curves: where does an even fight tip, and how wide is the coin-flip band?
  const LV = [-30, -20, -10, 0, 10, 20, 30];
  console.log(`mirror curves, placements ${P} x seeds ${S}. win% at enemy power ${LV.join(" ")}; centre = 50% point, width = 80%->20%`);
  for (const name of presets) {
    const rules = PRESETS[name];
    if (!rules) throw new Error(`unknown preset ${name}`);
    console.log(`\n${name}`);
    for (const id of Object.keys(MIRRORS)) {
      const curve = LV.map((lvl) => measure(id, rules, lvl).win);
      const c50 = crossing(LV, curve, 50);
      const width = crossing(LV, curve, 20) - crossing(LV, curve, 80);
      console.log(`  ${id}  ${curve.map(f).join("")}   centre ${c50.toFixed(0).padStart(4)}  width ${width.toFixed(0).padStart(3)}`);
    }
  }
  process.exit(0);
}

console.log(`placements ${P} x seeds ${S}.  cells: win% / placeSD / coin%   (mirrors: win% at enemy +0 / +15 / +30)`);
for (const name of presets) {
  const rules = PRESETS[name];
  if (!rules) throw new Error(`unknown preset ${name}`);
  const t0 = performance.now();
  const cells: string[] = [];
  let sdSum = 0;
  let coinSum = 0;
  for (const id of real) {
    const m = measure(id, rules);
    sdSum += m.sd;
    coinSum += m.coin;
    cells.push(`${id} ${f(m.win)}/${f(m.sd)}/${f(m.coin)}`);
  }
  for (const id of Object.keys(MIRRORS)) {
    const m0 = measure(id, rules);
    sdSum += m0.sd;
    coinSum += m0.coin;
    const m15 = measure(id, rules, 15);
    const m30 = measure(id, rules, 30);
    cells.push(`${id} ${f(m0.win)}/${f(m0.sd)}/${f(m0.coin)} [${f(m15.win)}${f(m30.win)}]`);
  }
  const n = real.length + Object.keys(MIRRORS).length;
  console.log(`\n${name}: mean placeSD ${(sdSum / n).toFixed(1)}  mean coin% ${(coinSum / n).toFixed(1)}  (${((performance.now() - t0) / 1000).toFixed(0)}s)`);
  for (const c of cells) console.log(`  ${c}`);
}
