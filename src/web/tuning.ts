/**
 * Tuning panel: every balance dial the browser can reach, with its default (taken from the
 * sim's own constants, so it tracks balancing) and a reset. Only values that differ from the
 * default are stored (localStorage, per browser), so changing a default in code still takes
 * effect for untouched fields. Applies to single battles and runs; Playback is look-only.
 */
import { DEFAULT_RULES, DEFAULT_WEIGHTS, DIFFICULTIES, type BattleEvent, type Difficulty, type Rules, type SettleOptions } from "../sim/index.js";
import { DEFAULT_RUN } from "../run/run.js";

type Value = number | boolean | string;

interface FieldBase {
  key: string;
  label: string;
  help: string;
}
type Field =
  | (FieldBase & { kind: "number"; def: number; min: number; max: number; step: number })
  | (FieldBase & { kind: "bool"; def: boolean })
  | (FieldBase & { kind: "select"; def: string; options: string[] });

interface Group {
  name: string;
  note?: string;
  fields: Field[];
}

const num = (key: string, label: string, def: number, min: number, max: number, step: number, help: string): Field => ({ kind: "number", key, label, def, min, max, step, help });
const bool = (key: string, label: string, def: boolean, help: string): Field => ({ kind: "bool", key, label, def, help });
const sel = (key: string, label: string, def: string, options: string[], help: string): Field => ({ kind: "select", key, label, def, options, help });

const R = DEFAULT_RULES;
const W = DEFAULT_WEIGHTS;
const D = DIFFICULTIES;

/** Pause after each log event during playback, ms at 1x speed. */
const DURATION_DEFAULTS: Partial<Record<BattleEvent["kind"], number>> = {
  move: 200, push: 200, ability: 220, hit: 380, heal: 300, dot: 260, knockout: 450, say: 120, status: 60, gauge: 120, wait: 90,
};

const GROUPS: Group[] = [
  {
    name: "Pacing",
    fields: [
      num("rules.actionScale", "Action cost %", R.actionScale, 20, 200, 5, "Ability gauge cost and cooldowns. Lower = more, smaller actions (pair with HP)."),
      num("rules.hpScale", "HP %", R.hpScale, 50, 600, 10, "Everyone's max HP. Higher = each hit is a smaller share; longer fights."),
      num("rules.moveScale", "Move cost %", R.moveScale, 20, 300, 5, "Gauge per tile walked. Lower = units cover ground faster."),
      num("rules.waitCost", "Hold cost", R.waitCost, 5, 200, 5, "Gauge spent holding a turn (scaled by action cost)."),
      num("rules.damageSpread", "Damage spread ±%", R.damageSpread, 0, 60, 5, "Random variation per hit."),
    ],
  },
  {
    name: "Courage and aggression",
    fields: [
      num("rules.nerve", "Nerve %", R.nerve, 0, 100, 5, "Healthy units weigh danger at this %; full caution by half HP. 100 = off."),
      num("rules.advance", "Forward pressure", R.advance, 0, 30, 1, "Pull toward a target until something is in reach; also stops ping-ponging. 0 = off."),
      num("rules.impatience", "Impatience %", R.impatience, 0, 100, 5, "Caution lost per turn spent holding."),
      num("rules.pressureStart", "Pressure starts (tick)", R.pressureStart, 0, 3000, 25, "From this tick, everyone's caution decays..."),
      num("rules.pressureSpan", "Pressure span (ticks)", R.pressureSpan, 1, 3000, 25, "...reaching zero this many ticks later."),
      num("rules.doctrinePush", "Enemy advance push", R.doctrinePush, 0, 20, 1, "Extra aggression for an enemy squad ordered to advance."),
      num("rules.playerHold", "Player holds (tiles)", R.playerHold, 0, 10, 1, "Your squad waits until an enemy is this close. 0 = off."),
    ],
  },
  {
    name: "AI weights",
    note: "Every unit starts here; traits (brave, cowardly...) add on top.",
    fields: [
      num("weights.damage", "Damage", W.damage, 0, 40, 1, "Value of dealing damage."),
      num("weights.kill", "Kill", W.kill, 0, 40, 1, "Bonus for finishing a target."),
      num("weights.danger", "Danger", W.danger, 0, 40, 1, "Fear of tiles enemies can hit."),
      num("weights.support", "Support", W.support, 0, 40, 1, "Value of heals and buffs."),
      num("weights.aoe", "Area", W.aoe, 0, 40, 1, "Value of hitting several at once."),
      num("weights.tempo", "Tempo", W.tempo, 0, 40, 1, "Value per gauge spent: lower favours big, slow moves."),
      num("weights.aggression", "Aggression", W.aggression, 0, 40, 1, "How little distance discounts a target."),
    ],
  },
  {
    name: "Team play",
    fields: [
      bool("rules.formation", "Auto formation", R.formation, "Your squad arranges itself by role around the chosen spot."),
      bool("rules.focusFire", "Focus fire", R.focusFire, "Your squad picks one shared target."),
      bool("rules.commitTarget", "Commit to target", R.commitTarget, "Units prefer their current target (x1.5)."),
      num("rules.stride", "Stride (steps)", R.stride, 0, 8, 1, "Keep walking a plan this many steps without re-deciding. 0 = off."),
      num("rules.cohesion", "Cohesion", R.cohesion, 0, 30, 1, "Before contact, penalty per tile beyond 2 from the nearest ally."),
    ],
  },
  {
    name: "Fairness and luck",
    fields: [
      bool("rules.charge", "Charge", R.charge, "Stepping into range lets a unit strike the same turn."),
      num("rules.underdog", "Underdog %", R.underdog, 0, 50, 5, "Outnumbered side takes this much less damage per unit behind."),
      sel("rules.ties", "Initiative ties go to", R.ties, ["player", "enemy"], "Who acts first on an exact tie."),
      sel("rules.luck", "Luck", R.luck, ["meter", "dice"], "meter: no streaks, exact long-run rates. dice: real rolls."),
      num("rules.hitDice", "Hit dice", R.hitDice, 1, 5, 1, "With dice luck: average this many d100s (2 = Fire Emblem true hit)."),
      bool("rules.seededLuck", "Seeded luck", R.seededLuck, "With meter luck: the seed sets where meters start."),
      bool("rules.unitStreams", "Per-unit dice", R.unitStreams, "Each unit rolls from its own stream."),
    ],
  },
  {
    name: "Battle",
    fields: [
      num("battle.enemyPower", "Enemy power %", 0, -90, 300, 5, "Added to enemy HP and damage (single battles; runs use their ramp)."),
      num("battle.maxTicks", "Timeout (ticks)", 5000, 200, 20000, 100, "Declare a draw after this long."),
    ],
  },
  {
    name: "Settling",
    note: "Raw shows exactly the seed you picked: instant, but the result can flip with the seed.",
    fields: [
      sel("settle.mode", "Mode", "settled", ["settled", "raw"], "settled: simulate samples, decide by difficulty, show one. raw: just this seed."),
      num("settle.samples", "Samples", 24, 1, 120, 1, "Battles simulated per settled result."),
      bool("settle.smooth", "Smooth placement", true, "Spread samples over neighbouring formation spots."),
      num("settle.easy", "Easy: min win %", D.easy.threshold, 0, 100, 1, "Player win % needed to win on easy."),
      num("settle.normal", "Normal: min win %", D.normal.threshold, 0, 100, 1, "...on normal."),
      num("settle.hard", "Hard: min win %", D.hard.threshold, 0, 100, 1, "...on hard."),
      num("settle.easyMargin", "Easy: shown margin", D.easy.marginPercentile, 0, 100, 5, "Which battle to show: 0 = closest, 100 = most lopsided."),
      num("settle.normalMargin", "Normal: shown margin", D.normal.marginPercentile, 0, 100, 5, ""),
      num("settle.hardMargin", "Hard: shown margin", D.hard.marginPercentile, 0, 100, 5, ""),
    ],
  },
  {
    name: "Run",
    note: "Takes effect when a run starts.",
    fields: [
      num("run.ramp", "Ramp %/battle", DEFAULT_RUN.ramp, 0, 30, 1, "Enemy strength gained per battle."),
      num("run.hearts", "Hearts", DEFAULT_RUN.hearts, 1, 20, 1, "Starting and max hearts."),
    ],
  },
  {
    name: "Playback",
    note: "Look only: pause after each event at 1x speed (ms).",
    fields: Object.entries(DURATION_DEFAULTS).map(([k, v]) => num(`play.${k}`, k, v!, 0, 2000, 10, "")),
  },
];

const FIELDS = new Map(GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f] as const)));
const STORAGE_KEY = "tuning-v1";

let overrides: Record<string, Value> = load();

function load(): Record<string, Value> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, Value>;
    return sanitize(raw);
  } catch {
    return {};
  }
}

/** Keep only known keys with the right type, clamped to range; drop values equal to the default. */
function sanitize(raw: Record<string, unknown>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = FIELDS.get(k);
    if (!f) continue;
    if (f.kind === "number" && typeof v === "number" && Number.isFinite(v)) {
      const c = Math.min(f.max, Math.max(f.min, v));
      if (c !== f.def) out[k] = c;
    } else if (f.kind === "bool" && typeof v === "boolean" && v !== f.def) out[k] = v;
    else if (f.kind === "select" && typeof v === "string" && f.options.includes(v) && v !== f.def) out[k] = v;
  }
  return out;
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // storage unavailable: the values still apply for this visit
  }
}

function get(key: string): Value {
  return overrides[key] ?? FIELDS.get(key)!.def;
}
const n = (key: string) => get(key) as number;

// ------------------------------------------------------------------ what the game reads

/** Rule overrides for the battle engine (only the changed ones). */
export function tunedRules(): Partial<Rules> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(overrides)) if (k.startsWith("rules.")) out[k.slice(6)] = v;
  if (Object.keys(overrides).some((k) => k.startsWith("weights."))) {
    const w = { ...DEFAULT_WEIGHTS };
    for (const k of Object.keys(w) as (keyof typeof w)[]) w[k] = n(`weights.${k}`);
    (out as Partial<Rules>).baseWeights = w;
  }
  return out as Partial<Rules>;
}

export function enemyPower(): number {
  return n("battle.enemyPower");
}
export function maxTicks(): number {
  return n("battle.maxTicks");
}
export function rawMode(): boolean {
  return get("settle.mode") === "raw";
}
export function samples(): number {
  return n("settle.samples");
}
export function settleOverrides(d: Difficulty): Required<Pick<SettleOptions, "threshold" | "marginPercentile" | "smoothPlacement">> {
  return { threshold: n(`settle.${d}`), marginPercentile: n(`settle.${d}Margin`), smoothPlacement: get("settle.smooth") as boolean };
}
export function runConfig() {
  const hearts = n("run.hearts");
  return { ramp: n("run.ramp"), hearts, maxHearts: hearts, samples: samples() };
}
export function duration(kind: BattleEvent["kind"]): number {
  return FIELDS.has(`play.${kind}`) ? n(`play.${kind}`) : 0;
}
export function changedCount(): number {
  return Object.keys(overrides).length;
}

// ------------------------------------------------------------------ panel

/**
 * Render the panel into `root`. `onSubmit` fires on Enter in any field (fight again).
 * `onChange` fires after any edit.
 */
export function mountTuning(root: HTMLElement, onSubmit: () => void, onChange: () => void = () => {}) {
  const groupsEl = root.querySelector<HTMLElement>("[data-groups]")!;
  const countEl = root.querySelector<HTMLElement>("[data-count]")!;
  const rows = new Map<string, { row: HTMLElement; input: HTMLInputElement | HTMLSelectElement }>();
  const groupCounts: { el: HTMLElement; g: Group }[] = [];

  const refresh = () => {
    for (const [key, { row, input }] of rows) {
      const f = FIELDS.get(key)!;
      const v = get(key);
      if (input instanceof HTMLInputElement && f.kind === "bool") input.checked = v as boolean;
      else if (document.activeElement !== input) input.value = String(v);
      row.classList.toggle("changed", key in overrides);
    }
    for (const { el, g } of groupCounts) {
      const c = g.fields.filter((f) => f.key in overrides).length;
      el.textContent = c ? `${c} changed` : "";
    }
    const c = changedCount();
    countEl.textContent = c ? `${c} changed` : "all defaults";
  };

  const set = (key: string, v: Value) => {
    overrides = sanitize({ ...overrides, [key]: v });
    if (!(key in overrides)) delete overrides[key];
    save();
    refresh();
    onChange();
  };

  for (const g of GROUPS) {
    const det = document.createElement("details");
    det.className = "tgroup";
    const sum = document.createElement("summary");
    const count = document.createElement("span");
    count.className = "meta";
    sum.append(g.name, " ", count);
    groupCounts.push({ el: count, g });
    det.append(sum);
    if (g.note) det.append(Object.assign(document.createElement("p"), { className: "tnote", textContent: g.note }));
    for (const f of g.fields) {
      const row = document.createElement("div");
      row.className = "trow";
      const label = document.createElement("label");
      const id = `t-${f.key.replace(".", "-")}`;
      label.htmlFor = id;
      label.textContent = f.label;
      if (f.help) label.title = f.help;
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.kind === "select") {
        input = document.createElement("select");
        for (const o of f.options) input.add(new Option(o, o));
        input.addEventListener("change", () => set(f.key, input.value));
      } else if (f.kind === "bool") {
        input = Object.assign(document.createElement("input"), { type: "checkbox" });
        input.addEventListener("change", () => set(f.key, (input as HTMLInputElement).checked));
      } else {
        input = Object.assign(document.createElement("input"), { type: "number", min: String(f.min), max: String(f.max), step: String(f.step) });
        input.addEventListener("change", () => {
          const v = Number(input.value);
          if (input.value !== "" && Number.isFinite(v)) set(f.key, v);
          else refresh();
        });
      }
      input.id = id;
      input.addEventListener("keydown", (ev) => {
        if ((ev as KeyboardEvent).key !== "Enter") return;
        input.dispatchEvent(new Event("change"));
        onSubmit();
      });
      const def = document.createElement("button");
      def.type = "button";
      def.className = "tdef";
      def.textContent = `↺ ${f.def}`;
      def.title = `Default: ${f.def}. Click to reset.`;
      def.addEventListener("click", () => set(f.key, f.def));
      row.append(label, input, def);
      if (f.help) row.append(Object.assign(document.createElement("div"), { className: "thelp", textContent: f.help }));
      rows.set(f.key, { row, input });
      det.append(row);
    }
    groupsEl.append(det);
  }

  root.querySelector("[data-reset]")!.addEventListener("click", () => {
    overrides = {};
    save();
    refresh();
    onChange();
  });
  const status = root.querySelector<HTMLElement>("[data-status]")!;
  root.querySelector("[data-copy]")!.addEventListener("click", async () => {
    const text = JSON.stringify(overrides, null, 1);
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "Copied the changed values as JSON.";
    } catch {
      window.prompt("Copy these values:", text);
    }
  });
  root.querySelector("[data-paste]")!.addEventListener("click", () => {
    const text = window.prompt("Paste tuning JSON (replaces all current changes):", "");
    if (text === null) return;
    try {
      overrides = sanitize(JSON.parse(text) as Record<string, unknown>);
      save();
      refresh();
      onChange();
      status.textContent = `Loaded ${changedCount()} changed values.`;
    } catch {
      status.textContent = "That wasn't valid JSON.";
    }
  });
  refresh();
}
