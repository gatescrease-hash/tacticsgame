import type { BattleEvent, BattleLog, UnitSnapshot } from "./log.js";

/** Plain-text rendering of the battle log. A text log is enough at first. */
export function formatLog(log: BattleLog): string[] {
  const start = log[0];
  if (!start || start.kind !== "start") throw new Error("log must begin with a start event");
  const units = new Map<number, UnitSnapshot>(start.units.map((u) => [u.uid, { ...u }]));
  const name = (uid: number) => units.get(uid)?.name ?? `#${uid}`;
  return log.map((e) => `[t=${String(e.t).padStart(5)}] ${describe(e, units, name)}`);
}

function describe(e: BattleEvent, units: Map<number, UnitSnapshot>, name: (uid: number) => string): string {
  switch (e.kind) {
    case "start":
      return (
        `Battle '${e.scenario}' (seed ${e.seed}) begins: ` +
        e.units.map((u) => `${u.name} the ${u.className} [${u.side}] at ${u.pos.x},${u.pos.y}`).join("; ")
      );
    case "move":
      return `${name(e.uid)} moves ${e.from.x},${e.from.y} -> ${e.to.x},${e.to.y} (${e.cost})`;
    case "attack": {
      const tgt = units.get(e.target);
      const max = tgt?.maxHp ?? "?";
      const result =
        e.outcome === "hit"
          ? `${e.crit ? "CRITICAL hit" : "hit"} for ${e.damage} (${name(e.target)} ${e.hpAfter}/${max})`
          : e.outcome;
      return `${name(e.uid)} attacks ${name(e.target)}: ${result} (${e.cost})`;
    }
    case "wait":
      return `${name(e.uid)} waits (${e.cost})`;
    case "knockout":
      return `${name(e.uid)} is knocked out by ${name(e.by)}!`;
    case "end":
      return e.winner === "draw" ? `Draw (${e.reason}).` : `${e.winner === "player" ? "Player" : "Enemy"} side wins.`;
  }
}
