import type { BattleEvent, BattleLog, UnitSnapshot } from "./log.js";

/** Plain-text rendering of the battle log. */
export function formatLog(log: BattleLog, opts: { debug?: boolean } = {}): string[] {
  const start = log[0];
  if (!start || start.kind !== "start") throw new Error("log must begin with a start event");
  const units = new Map<number, UnitSnapshot>(start.units.map((u) => [u.uid, { ...u }]));
  const name = (uid: number) => units.get(uid)?.name ?? `#${uid}`;
  const out: string[] = [];
  for (const e of log) {
    if (e.kind === "turn") continue;
    if (e.kind === "decide" && !opts.debug) continue;
    out.push(`[t=${String(e.t).padStart(5)}] ${describeEvent(e, units, name)}`);
  }
  return out;
}

export function describeEvent(e: BattleEvent, units: Map<number, UnitSnapshot>, name: (uid: number) => string): string {
  switch (e.kind) {
    case "start":
      return (
        `Battle '${e.scenario}' (seed ${e.seed}) begins: ` +
        e.units.map((u) => `${u.name} the ${u.raceName} ${u.className} [${u.side}]`).join("; ")
      );
    case "turn":
      return `${name(e.uid)}'s turn`;
    case "move":
      return `${name(e.uid)} moves ${e.from.x},${e.from.y} -> ${e.to.x},${e.to.y} (${e.cost})`;
    case "ability":
      return e.counter
        ? `${name(e.uid)} counters ${name(e.target)}!`
        : `${name(e.uid)} uses ${e.abilityName} on ${name(e.target)} (${e.cost})`;
    case "hit": {
      const max = units.get(e.target)?.maxHp ?? "?";
      if (e.outcome !== "hit" && e.damage === 0 && e.components.length === 0) return `  ${name(e.target)}: ${e.outcome}`;
      const parts = e.components
        .filter((c) => c.damage > 0 || c.tier !== 2)
        .map((c) => `${c.damage} ${c.element ?? c.type}${c.tier === 3 ? " (weak!)" : c.tier === 1 ? " (resisted)" : c.tier === 0 ? " (immune)" : ""}`)
        .join(" + ");
      const extra = e.interaction ? ` [${e.interaction}]` : "";
      if (e.outcome === "glanced off") return `  ${name(e.target)}: glanced off${parts ? ` (${parts})` : ""}${extra}`;
      return `  ${name(e.target)}: ${e.crit ? "CRITICAL " : ""}${e.damage} damage${parts ? ` (${parts})` : ""}${extra} -> ${e.hpAfter}/${max}`;
    }
    case "heal":
      return `  ${name(e.target)} healed ${e.amount} -> ${e.hpAfter}/${units.get(e.target)?.maxHp ?? "?"}`;
    case "dot":
      return `${name(e.uid)} suffers ${e.damage} from ${e.status} -> ${e.hpAfter}/${units.get(e.uid)?.maxHp ?? "?"}`;
    case "status":
      return e.on ? `  ${name(e.uid)} is ${e.statusName.toLowerCase()}` : `${name(e.uid)} is no longer ${e.statusName.toLowerCase()}`;
    case "gauge":
      return `  ${name(e.target)}'s turn ${e.amount < 0 ? "is pushed back" : "comes sooner"} (${e.amount})`;
    case "push":
      return `  ${name(e.uid)} is knocked to ${e.to.x},${e.to.y}`;
    case "say":
      return `${name(e.uid)}: "${e.text}"`;
    case "wait":
      return `${name(e.uid)} holds (${e.cost})`;
    case "knockout":
      return `${name(e.uid)} is knocked out by ${name(e.by)}!`;
    case "decide":
      return `  [AI ${name(e.uid)}] ${e.candidates.map((c) => `${c.label}=${c.score}`).join(" | ")}`;
    case "end":
      return e.winner === "draw" ? `Draw (${e.reason}).` : `${e.winner === "player" ? "Player" : "Enemy"} side wins.`;
  }
}
