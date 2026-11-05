/**
 * Browser front end. Two screens:
 *  - Setup: place units inside the deploy zone, bench units, read the scouting
 *    report and preview the opening turn order.
 *  - Battle: the fight is baked in a web worker, then replayed from the log.
 * Rendering only ever reads the battle log, never simulation state.
 */
import { content, scenarioIds } from "../content/index.js";
import { describeEvent, previewTurnOrder, type BattleEvent, type BattleLog, type Difficulty, type Pos, type UnitSnapshot } from "../sim/index.js";
import type { BakeRequest } from "./bake.worker.js";

const TILE = 56;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const scenarioSel = $<HTMLSelectElement>("scenario");
const seedInput = $<HTMLInputElement>("seed");
const difficultySel = $<HTMLSelectElement>("difficulty");
const speedSel = $<HTMLSelectElement>("speed");
const fightBtn = $<HTMLButtonElement>("fight");
const pauseBtn = $<HTMLButtonElement>("pause");
const backBtn = $<HTMLButtonElement>("back");
const canvas = $<HTMLCanvasElement>("board");
const banner = $<HTMLDivElement>("banner");
const hint = $<HTMLParagraphElement>("hint");
const turnbar = $<HTMLDivElement>("turnbar");
const logEl = $<HTMLDivElement>("log");
const ctx = canvas.getContext("2d")!;

const worker = new Worker(new URL("./bake.worker.ts", import.meta.url), { type: "module" });

// ------------------------------------------------------------------ shared drawing

function colors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    floor: v("--floor"), wall: v("--wall"), swamp: v("--swamp"), thicket: v("--thicket"), zone: v("--zone"),
    player: v("--player"), enemy: v("--enemy"), accent: v("--accent"), text: v("--text"), panel: v("--panel"),
  };
}

function sizeCanvas(w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * TILE * dpr;
  canvas.height = h * TILE * dpr;
  canvas.style.width = `${w * TILE}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawMap(map: string[], c: ReturnType<typeof colors>) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  map.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      ctx.fillStyle = ch === "#" ? c.wall : ch === "~" ? c.swamp : ch === '"' ? c.thicket : c.floor;
      ctx.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
      if (ch === '"') {
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        for (let i = 0; i < 3; i++) ctx.fillRect(x * TILE + 12 + i * 12, y * TILE + 18 + (i % 2) * 10, 4, 16);
      }
    }),
  );
}

function drawUnitToken(x: number, y: number, label: string, side: "player" | "enemy", c: ReturnType<typeof colors>, opts: { alpha?: number; ring?: boolean; hp?: number; maxHp?: number; statuses?: string[] } = {}) {
  const cx = x * TILE + TILE / 2;
  const cy = y * TILE + TILE / 2;
  ctx.globalAlpha = opts.alpha ?? 1;
  if (opts.ring) {
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, TILE * 0.4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = side === "player" ? c.player : c.enemy;
  ctx.beginPath();
  ctx.arc(cx, cy, TILE * 0.31, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, cy + 1);
  if (opts.hp !== undefined && opts.maxHp) {
    const w = TILE - 12;
    const top = cy + TILE * 0.36;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(cx - w / 2, top, w, 5);
    const f = Math.max(0, opts.hp / opts.maxHp);
    ctx.fillStyle = f > 0.5 ? "#4caf50" : f > 0.25 ? "#e0b04a" : "#e05d52";
    ctx.fillRect(cx - w / 2, top, w * f, 5);
  }
  if (opts.statuses?.length) {
    ctx.font = "bold 9px system-ui";
    ctx.textAlign = "left";
    opts.statuses.slice(0, 3).forEach((s, i) => {
      const bx = x * TILE + 3 + i * 17;
      const by = y * TILE + 3;
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.fillRect(bx, by, 16, 11);
      ctx.fillStyle = "#fff";
      ctx.fillText(s, bx + 2, by + 6);
    });
  }
  ctx.globalAlpha = 1;
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 };

/** Two-character token label: "Automaton II" -> "A2", "Brother Oswin" -> "Os", "Sela" -> "Se". */
function initials(name: string): string {
  const words = name.split(" ");
  const last = words.at(-1)!;
  if (words.length > 1 && ROMAN[last]) return `${words[0]![0]}${ROMAN[last]}`;
  return last.slice(0, 2);
}

function renderTurnbar(label: string, order: { name: string; side: "player" | "enemy" }[], nowIndex = -1) {
  turnbar.replaceChildren(
    Object.assign(document.createElement("span"), { className: "label", textContent: label }),
    ...order.map((u, i) => {
      const chip = document.createElement("span");
      chip.className = `chip ${u.side}${i === nowIndex ? " now" : ""}`;
      chip.textContent = initials(u.name);
      chip.title = u.name;
      return chip;
    }),
  );
}

// ------------------------------------------------------------------ setup screen

interface SetupState {
  scenarioId: string;
  placements: Record<number, Pos>;
  benched: Set<number>;
  /** Where each deployed unit ends up after the squad forms up (scenario index -> tile). */
  formed: Map<number, Pos>;
  /** The tile the player chose for the squad to form up around. */
  anchor: Pos | null;
}

let setup: SetupState;
let screen: "setup" | "battle" = "setup";

for (const id of scenarioIds) scenarioSel.add(new Option(content.scenarios[id]!.name, id));
scenarioSel.value = "patrol";

function startSetup(scenarioId: string) {
  const sc = content.scenarios[scenarioId]!;
  setup = { scenarioId, placements: {}, benched: new Set(), formed: new Map(), anchor: null };
  sc.units.forEach((u, i) => {
    if (u.side === "player") setup.placements[i] = { ...u.pos };
  });
  showSetup();
}

function showSetup() {
  screen = "setup";
  stopPlayback();
  banner.hidden = true;
  $("setup-panel").hidden = false;
  $("battle-panel").hidden = true;
  pauseBtn.hidden = true;
  backBtn.hidden = true;
  fightBtn.hidden = false;
  scenarioSel.disabled = false;
  hint.textContent =
    "Click a highlighted tile to choose where your squad forms up; they arrange themselves by role (melee front, ranged behind). Untick units to bench them. Then press Fight!";
  const sc = content.scenarios[setup.scenarioId]!;
  sizeCanvas(sc.map[0]!.length, sc.map.length);
  renderScouting();
  renderRoster();
  refreshPreview();
  drawSetup();
}

function renderScouting() {
  const sc = content.scenarios[setup.scenarioId]!;
  $("scouting").textContent = sc.scouting;
  // A general picture, not every detail: classes and body types, no stats.
  const counts = new Map<string, number>();
  for (const su of sc.units) {
    if (su.side !== "enemy") continue;
    const def = content.units[su.unitId]!;
    const key = `${content.races[def.raceId]!.name} ${content.classes[def.classId]!.name}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  $("enemies").replaceChildren(
    ...[...counts].map(([k, n]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="dot"></span><span>${n > 1 ? `${n}× ` : ""}${k}</span>`;
      return li;
    }),
  );
}

function renderRoster() {
  const sc = content.scenarios[setup.scenarioId]!;
  const items: HTMLLIElement[] = [];
  sc.units.forEach((su, i) => {
    if (su.side !== "player") return;
    const def = content.units[su.unitId]!;
    const li = document.createElement("li");
    li.className = setup.benched.has(i) ? "benched" : "";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = !setup.benched.has(i);
    box.title = "Deploy this unit";
    box.addEventListener("change", () => {
      if (!box.checked) {
        const deployed = sc.units.filter((u, j) => u.side === "player" && !setup.benched.has(j)).length;
        if (deployed <= 1) {
          box.checked = true;
          return;
        }
        setup.benched.add(i);
      } else setup.benched.delete(i);
      renderRoster();
      refreshPreview();
      drawSetup();
    });
    const traits = def.traits.map((t) => content.traits[t]!.name).join(", ");
    const text = document.createElement("span");
    text.innerHTML = `<span class="dot"></span> `;
    const label = document.createElement("span");
    label.innerHTML = `<strong>${def.name}</strong> <span class="meta">${content.races[def.raceId]!.name} ${content.classes[def.classId]!.name} · ${content.weapons[def.weaponId]!.name} · ${traits}</span>`;
    li.append(box, text, label);
    items.push(li);
  });
  $("roster").replaceChildren(...items);
}

function opts() {
  return { placements: setup.placements, benched: [...setup.benched] };
}

function refreshPreview() {
  const { units, order } = previewTurnOrder(content, setup.scenarioId, 12, opts());
  renderTurnbar("Opening order:", order.map((uid) => units[uid]!));
  // Battle units are created in scenario order, skipping benched ones.
  setup.formed.clear();
  let uid = 0;
  content.scenarios[setup.scenarioId]!.units.forEach((_, i) => {
    if (setup.benched.has(i)) return;
    const snap = units[uid++]!;
    if (snap.side === "player") setup.formed.set(i, snap.pos);
  });
}

function inZone(p: Pos): boolean {
  const z = content.scenarios[setup.scenarioId]!.deployZone;
  return p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1;
}

function drawSetup() {
  const sc = content.scenarios[setup.scenarioId]!;
  const c = colors();
  drawMap(sc.map, c);
  const z = sc.deployZone;
  for (let y = z.y0; y <= z.y1; y++) {
    for (let x = z.x0; x <= z.x1; x++) {
      if (sc.map[y]![x] === "#") continue;
      ctx.fillStyle = c.zone;
      ctx.fillRect(x * TILE + 1, y * TILE + 1, TILE - 2, TILE - 2);
    }
  }
  sc.units.forEach((su, i) => {
    const def = content.units[su.unitId]!;
    if (su.side === "enemy") {
      drawUnitToken(su.pos.x, su.pos.y, "?", "enemy", c, { alpha: 0.55 });
      return;
    }
    if (setup.benched.has(i)) return;
    const p = setup.formed.get(i) ?? setup.placements[i]!;
    drawUnitToken(p.x, p.y, initials(def.name), "player", c);
  });
  if (setup.anchor) {
    // Mark where the squad forms up.
    const { x, y } = setup.anchor;
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(x * TILE + 4, y * TILE + 4, TILE - 8, TILE - 8);
    ctx.setLineDash([]);
  }
}

function tileFromEvent(ev: MouseEvent): Pos {
  const r = canvas.getBoundingClientRect();
  const scale = r.width / (canvas.width / (window.devicePixelRatio || 1));
  return { x: Math.floor((ev.clientX - r.left) / scale / TILE), y: Math.floor((ev.clientY - r.top) / scale / TILE) };
}

canvas.addEventListener("click", (ev) => {
  if (screen !== "setup") return;
  const sc = content.scenarios[setup.scenarioId]!;
  const p = tileFromEvent(ev);
  if (!inZone(p) || sc.map[p.y]?.[p.x] === "#") return;
  // The squad forms up around the chosen tile: every deployed unit starts there and the
  // formation spreads them out by role.
  setup.anchor = p;
  sc.units.forEach((u, i) => {
    if (u.side === "player") setup.placements[i] = { ...p };
  });
  refreshPreview();
  drawSetup();
});

scenarioSel.addEventListener("change", () => startSetup(scenarioSel.value));

// ------------------------------------------------------------------ battle playback

interface PUnit extends UnitSnapshot {
  x: number;
  y: number;
  from: Pos;
  to: Pos;
  moveStart: number;
  moveEnd: number;
  alive: boolean;
  statuses: Map<string, string>;
}

interface Floater { uid: number; text: string; color: string; start: number; until: number }
interface Bubble { uid: number; text: string; until: number }
interface Line { a: number; b: number; color: string; until: number }

/** How long each event holds the stage at 1x, in ms. */
const DURATION: Partial<Record<BattleEvent["kind"], number>> = {
  move: 200, push: 200, ability: 220, hit: 380, heal: 300, dot: 260, knockout: 450, say: 120, status: 60, gauge: 120, wait: 90,
};

let play: {
  log: BattleLog;
  idx: number;
  nextAt: number;
  paused: boolean;
  pausedAt: number;
  units: Map<number, PUnit>;
  current: number | null;
  floaters: Floater[];
  bubbles: Bubble[];
  lines: Line[];
  map: string[];
  raf: number;
} | null = null;

function speed(): number {
  return Number(speedSel.value);
}

function stopPlayback() {
  if (play) cancelAnimationFrame(play.raf);
  play = null;
}

fightBtn.addEventListener("click", () => {
  fightBtn.disabled = true;
  fightBtn.textContent = "Baking…";
  const req: BakeRequest = { scenario: setup.scenarioId, seed: Number(seedInput.value), difficulty: difficultySel.value as Difficulty, opts: opts() };
  worker.postMessage(req);
});

interface BakeResponse {
  log: BattleLog;
  winner: string;
  ms: number;
  winProb: number;
  samples: number;
  margin: number;
}

worker.onmessage = (ev: MessageEvent<BakeResponse>) => {
  fightBtn.disabled = false;
  fightBtn.textContent = "Fight!";
  startPlayback(ev.data);
};

pauseBtn.addEventListener("click", () => {
  if (!play) return;
  const now = performance.now();
  if (play.paused) {
    play.nextAt += now - play.pausedAt;
    play.paused = false;
    pauseBtn.textContent = "Pause";
  } else {
    play.paused = true;
    play.pausedAt = now;
    pauseBtn.textContent = "Resume";
  }
});

backBtn.addEventListener("click", () => showSetup());

function startPlayback(bake: BakeResponse) {
  const { log } = bake;
  const start = log[0];
  if (!start || start.kind !== "start") return;
  stopPlayback();
  screen = "battle";
  $("setup-panel").hidden = true;
  $("battle-panel").hidden = false;
  pauseBtn.hidden = false;
  pauseBtn.textContent = "Pause";
  backBtn.hidden = false;
  fightBtn.hidden = true;
  scenarioSel.disabled = true;
  banner.hidden = true;
  logEl.replaceChildren();
  // Prototype transparency: show how the result was settled.
  hint.textContent =
    `Your setup won ${bake.winProb}% of ${bake.samples} simulated battles; on ${difficultySel.value} that settles as a ` +
    `${bake.winner === "player" ? "win" : "loss"}. Showing one of those battles (simulated in ${bake.ms.toFixed(0)} ms). ` +
    `Change the seed to watch a different one with the same result.`;
  sizeCanvas(start.width, start.height);
  const units = new Map<number, PUnit>(
    start.units.map((u) => [u.uid, { ...u, x: u.pos.x, y: u.pos.y, from: u.pos, to: u.pos, moveStart: 0, moveEnd: 0, alive: true, statuses: new Map() }]),
  );
  play = { log, idx: 0, nextAt: performance.now(), paused: false, pausedAt: 0, units, current: null, floaters: [], bubbles: [], lines: [], map: start.map, raf: 0 };
  play.raf = requestAnimationFrame(frame);
}

function frame(now: number) {
  if (!play) return;
  const p = play;
  while (!p.paused && p.idx < p.log.length && now >= p.nextAt) {
    const e = p.log[p.idx]!;
    applyEvent(e, now);
    p.nextAt = now + (DURATION[e.kind] ?? 0) / speed();
    p.idx++;
  }
  draw(now);
  p.raf = requestAnimationFrame(frame);
}

function applyEvent(e: BattleEvent, now: number) {
  const p = play!;
  const sp = speed();
  const u = (uid: number) => p.units.get(uid)!;
  const float = (uid: number, text: string, color: string) =>
    p.floaters.push({ uid, text, color, start: now, until: now + 900 / Math.min(sp, 2) });
  switch (e.kind) {
    case "turn": {
      p.current = e.uid;
      if (e.queue) renderTurnbar("Next:", [e.uid, ...e.queue.slice(0, 9)].map((id) => u(id)), 0);
      break;
    }
    case "move":
    case "push": {
      const x = u(e.uid);
      x.from = { x: x.x, y: x.y };
      x.to = e.to;
      x.moveStart = now;
      x.moveEnd = now + (DURATION.move ?? 200) / sp;
      if (e.kind === "push") float(e.uid, "pushed", "#ccc");
      break;
    }
    case "ability":
      p.lines.push({ a: e.uid, b: e.target, color: e.counter ? "#e0b04a" : "#fff", until: now + 350 / sp });
      if (e.counter) float(e.uid, "counter!", "#e0b04a");
      else if (e.ability !== "attack") float(e.uid, e.abilityName, "#fff");
      break;
    case "hit": {
      const t = u(e.target);
      t.hp = e.hpAfter;
      if (e.outcome === "hit") float(e.target, `-${e.damage}${e.crit ? "!" : ""}`, e.crit ? "#ff5d5d" : "#ffb74d");
      else float(e.target, e.outcome, "#bbb");
      if (e.interaction) float(e.target, e.interaction, "#7fd3ff");
      break;
    }
    case "heal":
      u(e.target).hp = e.hpAfter;
      float(e.target, `+${e.amount}`, "#7ddc7d");
      break;
    case "dot":
      u(e.uid).hp = e.hpAfter;
      float(e.uid, `-${e.damage} ${e.status}`, "#ff9d4d");
      break;
    case "status":
      if (e.on) u(e.uid).statuses.set(e.status, e.short);
      else u(e.uid).statuses.delete(e.status);
      break;
    case "gauge":
      float(e.target, e.amount < 0 ? "delayed" : "hastened", "#c9a0ff");
      break;
    case "say":
      p.bubbles = p.bubbles.filter((b) => b.uid !== e.uid);
      p.bubbles.push({ uid: e.uid, text: e.text, until: now + Math.max(900, 2000 / sp) });
      break;
    case "knockout":
      u(e.uid).alive = false;
      u(e.uid).statuses.clear();
      break;
    case "end":
      banner.hidden = false;
      banner.textContent = e.winner === "player" ? "Victory" : e.winner === "enemy" ? "Defeat" : "Draw";
      pauseBtn.hidden = true;
      break;
    default:
      break;
  }
  if (e.kind !== "turn" && e.kind !== "decide" && e.kind !== "start") {
    const div = document.createElement("div");
    const names = new Map([...p.units].map(([k, v]) => [k, v as UnitSnapshot]));
    div.textContent = describeEvent(e, names, (uid) => p.units.get(uid)?.name ?? `#${uid}`);
    if (e.kind === "say") div.className = "say";
    logEl.append(div);
    logEl.scrollTop = logEl.scrollHeight;
  }
}

function draw(now: number) {
  const p = play!;
  const c = colors();
  drawMap(p.map, c);
  const centre = (x: number, y: number) => [x * TILE + TILE / 2, y * TILE + TILE / 2] as const;

  for (const x of p.units.values()) {
    if (now >= x.moveEnd) {
      x.x = x.to.x;
      x.y = x.to.y;
    } else {
      const f = (now - x.moveStart) / (x.moveEnd - x.moveStart);
      x.x = x.from.x + (x.to.x - x.from.x) * f;
      x.y = x.from.y + (x.to.y - x.from.y) * f;
    }
  }

  p.lines = p.lines.filter((l) => l.until > now);
  for (const l of p.lines) {
    const a = p.units.get(l.a)!;
    const b = p.units.get(l.b)!;
    const [ax, ay] = centre(a.x, a.y);
    const [bx, by] = centre(b.x, b.y);
    ctx.strokeStyle = l.color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  for (const x of p.units.values()) {
    if (!x.alive) continue;
    drawUnitToken(x.x, x.y, initials(x.name), x.side, c, { ring: p.current === x.uid, hp: x.hp, maxHp: x.maxHp, statuses: [...x.statuses.values()] });
  }

  p.floaters = p.floaters.filter((f) => f.until > now);
  ctx.font = "bold 13px system-ui";
  ctx.textAlign = "center";
  for (const f of p.floaters) {
    const x = p.units.get(f.uid)!;
    const [cx, cy] = centre(x.x, x.y);
    const t = (now - f.start) / (f.until - f.start);
    ctx.globalAlpha = 1 - t * 0.7;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(f.text, cx + 1, cy - 12 - t * 18 + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, cx, cy - 12 - t * 18);
  }
  ctx.globalAlpha = 1;

  // Speech bubbles explain actions in character.
  p.bubbles = p.bubbles.filter((b) => b.until > now);
  ctx.font = "12px system-ui";
  for (const b of p.bubbles) {
    const x = p.units.get(b.uid)!;
    const [cx, cy] = centre(x.x, x.y);
    const w = Math.min(220, ctx.measureText(b.text).width + 14);
    const cw = canvas.width / (window.devicePixelRatio || 1);
    const bx = Math.max(2, Math.min(cw - w - 2, cx - w / 2));
    const by = Math.max(2, cy - TILE * 0.75 - 20);
    ctx.fillStyle = c.panel;
    ctx.strokeStyle = x.side === "player" ? c.player : c.enemy;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(bx, by, w, 20, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.text;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(b.text, bx + 7, by + 10, w - 14);
    ctx.textAlign = "center";
  }
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (screen === "setup") drawSetup();
});

startSetup(scenarioSel.value);
