/**
 * Minimal playback (build step 7 placeholder). Bakes a battle synchronously,
 * then replays the log. Rendering only ever reads the log, never the sim state.
 * TODO: bake in a web worker; turn-order bar; speech bubbles.
 */
import { content, scenarioIds } from "../content/index.js";
import { formatLog, runBattle, type BattleEvent, type BattleLog, type UnitSnapshot } from "../sim/index.js";

const TILE = 56;
const STEP_MS = 400; // per event at 1x

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scenarioSel = $<HTMLSelectElement>("scenario");
const seedInput = $<HTMLInputElement>("seed");
const speedSel = $<HTMLSelectElement>("speed");
const canvas = $<HTMLCanvasElement>("board");
const logEl = $<HTMLPreElement>("log");
const ctx = canvas.getContext("2d")!;

for (const id of scenarioIds) scenarioSel.add(new Option(content.scenarios[id]!.name, id));

let timer: number | undefined;

$<HTMLButtonElement>("play").addEventListener("click", () => {
  const result = runBattle(content, scenarioSel.value, Number(seedInput.value));
  play(result.log);
});

function play(log: BattleLog) {
  window.clearTimeout(timer);
  const start = log[0];
  if (!start || start.kind !== "start") return;
  const units = new Map<number, UnitSnapshot & { alive: boolean }>(start.units.map((u) => [u.uid, { ...u, pos: { ...u.pos }, alive: true }]));
  canvas.width = start.width * TILE;
  canvas.height = start.height * TILE;

  const lines = formatLog(log);
  logEl.replaceChildren(...lines.map((l) => Object.assign(document.createElement("div"), { textContent: l })));

  let i = 0;
  const step = () => {
    const e = log[i]!;
    apply(e, units);
    draw(start.map, units, e);
    const rows = logEl.children;
    rows[i - 1]?.classList.remove("current");
    rows[i]?.classList.add("current");
    rows[i]?.scrollIntoView({ block: "nearest" });
    i++;
    if (i < log.length) timer = window.setTimeout(step, e.kind === "wait" ? 0 : STEP_MS / Number(speedSel.value));
  };
  step();
}

function apply(e: BattleEvent, units: Map<number, UnitSnapshot & { alive: boolean }>) {
  if (e.kind === "move") units.get(e.uid)!.pos = { ...e.to };
  if (e.kind === "attack") units.get(e.target)!.hp = e.hpAfter;
  if (e.kind === "knockout") units.get(e.uid)!.alive = false;
}

function draw(map: string[], units: Map<number, UnitSnapshot & { alive: boolean }>, e: BattleEvent) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  map.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      ctx.fillStyle = ch === "#" ? "#45484f" : ch === "~" ? "#2a3d3a" : "#262a32";
      ctx.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
    }),
  );

  const centre = (p: { x: number; y: number }) => [p.x * TILE + TILE / 2, p.y * TILE + TILE / 2] as const;

  if (e.kind === "attack") {
    const [ax, ay] = centre(units.get(e.uid)!.pos);
    const [tx, ty] = centre(units.get(e.target)!.pos);
    ctx.strokeStyle = e.outcome === "hit" ? (e.crit ? "#ff5d5d" : "#e0b04a") : "#8a8f98";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }

  for (const u of units.values()) {
    if (!u.alive) continue;
    const [cx, cy] = centre(u.pos);
    ctx.fillStyle = u.side === "player" ? "#4a90e2" : "#d9534f";
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(u.name.slice(0, 2), cx, cy);
    // HP bar under each unit
    const w = TILE - 12;
    ctx.fillStyle = "#111";
    ctx.fillRect(cx - w / 2, cy + TILE * 0.36, w, 5);
    ctx.fillStyle = "#5cb85c";
    ctx.fillRect(cx - w / 2, cy + TILE * 0.36, (w * u.hp) / u.maxHp, 5);
  }
}
