import { TILE_KINDS } from "./grid.js";
import { DERIVED_KEYS, STAT_NAMES, type Content, type Effect, type Modifier } from "./types.js";

/**
 * Catch content mistakes early: unknown ids, missing stats, bad keys, units off
 * the map. Returns a list of human-readable problems (empty = all good).
 */
export function validateContent(c: Content): string[] {
  const errors: string[] = [];
  const err = (where: string, msg: string) => errors.push(`${where}: ${msg}`);
  const modKeys = new Set<string>([...STAT_NAMES, ...DERIVED_KEYS]);

  const checkMods = (where: string, mods: Modifier[] | undefined) => {
    for (const m of mods ?? []) if (!modKeys.has(m.key)) err(where, `unknown modifier key '${m.key}'`);
  };
  const checkEffects = (where: string, effects: Effect[] | undefined) => {
    for (const e of effects ?? []) {
      if ((e.kind === "buildup" || e.kind === "status") && !c.statuses[e.status]) err(where, `unknown status '${e.status}'`);
      if (e.kind === "damage") {
        const share = e.packet.reduce((a, p) => a + p.share, 0);
        if (share !== 100) err(where, `damage packet shares sum to ${share}, expected 100`);
      }
    }
  };
  const checkIds = (where: string, ids: string[] | undefined, table: Record<string, unknown>, what: string) => {
    for (const id of ids ?? []) if (!table[id]) err(where, `unknown ${what} '${id}'`);
  };
  const checkTableIds = (name: string, table: Record<string, { id: string }>) => {
    for (const [key, v] of Object.entries(table)) if (v.id !== key) err(`${name}.${key}`, `id '${v.id}' doesn't match its key`);
  };

  checkTableIds("races", c.races);
  checkTableIds("classes", c.classes);
  checkTableIds("weapons", c.weapons);
  checkTableIds("trinkets", c.trinkets);
  checkTableIds("statuses", c.statuses);
  checkTableIds("abilities", c.abilities);
  checkTableIds("passives", c.passives);
  checkTableIds("traits", c.traits);
  checkTableIds("units", c.units);
  checkTableIds("scenarios", c.scenarios);

  for (const r of Object.values(c.races)) {
    checkIds(`race ${r.id}`, r.passives, c.passives, "passive");
    checkIds(`race ${r.id}`, r.lockedClasses, c.classes, "class");
  }
  for (const cl of Object.values(c.classes)) {
    checkIds(`class ${cl.id}`, cl.abilities, c.abilities, "ability");
    checkIds(`class ${cl.id}`, cl.passives, c.passives, "passive");
    if (cl.moveCost <= 0) err(`class ${cl.id}`, "moveCost must be positive");
  }
  for (const w of Object.values(c.weapons)) {
    checkEffects(`weapon ${w.id}`, [{ kind: "damage", packet: w.packet, power: { base: 0 } }]);
    checkIds(`weapon ${w.id}`, w.passives, c.passives, "passive");
    if (w.range.min > w.range.max) err(`weapon ${w.id}`, "range.min > range.max");
  }
  for (const t of Object.values(c.trinkets)) {
    checkMods(`trinket ${t.id}`, t.mods);
    checkIds(`trinket ${t.id}`, t.passives, c.passives, "passive");
  }
  for (const s of Object.values(c.statuses)) {
    checkMods(`status ${s.id}`, s.mods);
    checkIds(`status ${s.id}`, s.removes, c.statuses, "status");
    if (s.threshold <= 0) err(`status ${s.id}`, "threshold must be positive");
  }
  for (const a of Object.values(c.abilities)) {
    checkEffects(`ability ${a.id}`, a.effects);
    if (a.range.min > a.range.max) err(`ability ${a.id}`, "range.min > range.max");
  }
  for (const p of Object.values(c.passives)) {
    checkMods(`passive ${p.id}`, p.mods);
    checkEffects(`passive ${p.id}`, p.effects);
    if ((p.counter || p.effects) && !p.trigger) err(`passive ${p.id}`, "has a reaction but no trigger");
  }
  for (const t of Object.values(c.traits)) checkIds(`trait ${t.id}`, t.passives, c.passives, "passive");

  for (const u of Object.values(c.units)) {
    const where = `unit ${u.id}`;
    const race = c.races[u.raceId];
    const cls = c.classes[u.classId];
    const weapon = c.weapons[u.weaponId];
    if (!race) err(where, `unknown race '${u.raceId}'`);
    if (!cls) err(where, `unknown class '${u.classId}'`);
    if (!weapon) err(where, `unknown weapon '${u.weaponId}'`);
    checkIds(where, u.trinkets, c.trinkets, "trinket");
    checkIds(where, u.traits, c.traits, "trait");
    if (u.trinkets.length > 2) err(where, "more than 2 trinkets");
    for (const s of STAT_NAMES) if (typeof u.stats[s] !== "number") err(where, `missing stat '${s}'`);
    if (cls && weapon && !cls.weaponTypes.includes(weapon.type)) err(where, `${cls.name} can't use ${weapon.type}s`);
    if (race && cls && race.lockedClasses?.includes(cls.id)) err(where, `${race.name} can't be a ${cls.name}`);
  }

  for (const sc of Object.values(c.scenarios)) {
    const where = `scenario ${sc.id}`;
    const w = sc.map[0]?.length ?? 0;
    sc.map.forEach((row, y) => {
      if (row.length !== w) err(where, `map row ${y} has length ${row.length}, expected ${w}`);
      for (const ch of row) if (!TILE_KINDS[ch]) err(where, `unknown map tile '${ch}' in row ${y}`);
    });
    if (sc.heights) {
      if (sc.heights.length !== sc.map.length) err(where, `heights has ${sc.heights.length} rows, map has ${sc.map.length}`);
      sc.heights.forEach((row, y) => {
        if (row.length !== w) err(where, `heights row ${y} has length ${row.length}, expected ${w}`);
        if (!/^[0-9]*$/.test(row)) err(where, `heights row ${y} must be digits (metres)`);
      });
    }
    const seen = new Set<string>();
    for (const su of sc.units) {
      if (!c.units[su.unitId]) err(where, `unknown unit '${su.unitId}'`);
      const { x, y } = su.pos;
      const ch = sc.map[y]?.[x];
      if (ch === undefined) err(where, `${su.unitId} placed off the map at ${x},${y}`);
      else if (TILE_KINDS[ch]?.blocked) err(where, `${su.unitId} placed on a wall at ${x},${y}`);
      const key = `${x},${y}`;
      if (seen.has(key)) err(where, `two units at ${key}`);
      seen.add(key);
      const z = sc.deployZone;
      if (su.side === "player" && (x < z.x0 || x > z.x1 || y < z.y0 || y > z.y1)) err(where, `player unit ${su.unitId} outside deploy zone`);
    }
    checkMods(where, sc.enemyMods);
    if (!sc.units.some((u) => u.side === "player")) err(where, "no player units");
    if (!sc.units.some((u) => u.side === "enemy")) err(where, "no enemy units");
  }
  return errors;
}
