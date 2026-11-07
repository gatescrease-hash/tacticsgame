import type { Stats, UnitDef } from "../sim/types.js";

/** Compact stat line: hp, str, skl, spd, agi, def, arc, mnd, spr, res, lck. */
function s(...v: [number, number, number, number, number, number, number, number, number, number, number]): Stats {
  const [hp, strength, skill, speed, agility, defense, arcana, mind, spirit, resolve, luck] = v;
  return { hp, strength, skill, speed, agility, defense, arcana, mind, spirit, resolve, luck };
}

function u(id: string, name: string, raceId: string, classId: string, weaponId: string, stats: Stats, traits: string[], trinkets: string[] = []): UnitDef {
  return { id, name, raceId, classId, weaponId, stats, traits, trinkets };
}

/** Preset units at fixed levels stand in for progression. */
export const units: Record<string, UnitDef> = Object.fromEntries(
  [
    // ---------------- the player's company
    u("aldric", "Aldric", "human", "knight", "emberblade", s(26, 9, 5, 7, 2, 2, 1, 3, 3, 8, 3), ["brave"]),
    u("vex", "Vex", "human", "duelist", "estoc", s(22, 6, 8, 11, 7, 2, 2, 5, 2, 4, 6), ["reckless"], ["whetstone"]),
    u("wren", "Wren", "human", "archer", "shortbow", s(20, 6, 7, 8, 5, 1, 2, 4, 3, 3, 5), ["cowardly"], ["lucky_charm"]),
    u("sela", "Sela", "human", "pyromancer", "staff", s(18, 2, 4, 8, 3, 0, 8, 5, 3, 5, 4), ["smart"], ["warding_amulet"]),
    u("oswin", "Brother Oswin", "human", "cleric", "mace", s(22, 5, 4, 7, 2, 2, 3, 4, 7, 7, 4), ["loyal"]),
    u("kesh", "Kesh", "lizardfolk", "skirmisher", "venom_dagger", s(19, 5, 6, 11, 6, 1, 1, 4, 2, 4, 5), ["reckless"]),
    u("mira", "Mira", "human", "stormcaller", "staff", s(18, 2, 4, 8, 3, 0, 8, 5, 3, 4, 4), ["smart"]),
    u("ilya", "Ilya", "human", "tactician", "staff", s(18, 3, 5, 9, 4, 0, 4, 8, 3, 6, 4), ["steady"], ["ring_of_haste"]),
    u("aeris", "Aeris", "winged", "skyguard", "javelin", s(19, 6, 7, 10, 6, 1, 2, 4, 3, 5, 5), ["brave"]),
    u("gorm", "Gorm", "lizardfolk", "brute", "mace", s(26, 8, 4, 6, 2, 2, 0, 2, 2, 6, 2), ["dim"]),
    // ---------------- the kingdom of Arago (textbook tactics)
    u("arago_spear_a", "Pikeman Hal", "human", "spearman", "spear", s(27, 8, 5, 7, 3, 2, 1, 3, 3, 5, 3), ["steady"]),
    u("arago_spear_b", "Pikeman Joss", "human", "spearman", "spear", s(27, 8, 5, 7, 3, 2, 1, 3, 3, 3, 3), ["dim"]),
    u("arago_xbow_a", "Bolt Marta", "human", "crossbowman", "crossbow", s(20, 6, 8, 6, 3, 1, 1, 3, 3, 3, 4), ["smart"]),
    u("arago_xbow_b", "Bolt Pell", "human", "crossbowman", "crossbow", s(20, 6, 7, 6, 3, 1, 1, 3, 3, 2, 3), ["cowardly"]),
    u("arago_knight", "Dame Orla", "human", "knight", "longsword", s(26, 9, 6, 7, 2, 2, 1, 3, 3, 7, 3), ["steady"]),
    u("arago_sergeant", "Sergeant Brask", "human", "sergeant", "longsword", s(30, 9, 6, 7, 3, 2, 1, 4, 3, 8, 3), ["brave"]),
    // ---------------- the castle garrison (siege)
    u("siege_xbow_a", "Bowman Tor", "human", "crossbowman", "crossbow", s(20, 6, 8, 6, 3, 1, 1, 3, 3, 4, 4), ["steady"]),
    u("siege_xbow_b", "Bowman Ide", "human", "crossbowman", "crossbow", s(20, 6, 7, 6, 3, 1, 1, 3, 3, 3, 3), ["smart"]),
    u("siege_xbow_c", "Bowman Rusk", "human", "crossbowman", "crossbow", s(20, 6, 7, 6, 3, 1, 1, 3, 3, 2, 3), ["cowardly"]),
    u("siege_spear_a", "Gate-warden Ulf", "human", "spearman", "spear", s(27, 8, 5, 7, 3, 2, 1, 3, 3, 6, 3), ["brave"]),
    u("siege_spear_b", "Gate-warden Bera", "human", "spearman", "spear", s(27, 8, 5, 7, 3, 2, 1, 3, 3, 5, 3), ["steady"]),
    u("siege_sergeant", "Sergeant Kell", "human", "sergeant", "longsword", s(30, 9, 6, 7, 3, 2, 1, 4, 3, 7, 3), ["cruel"]),
    u("siege_knight", "Ser Hadrian", "human", "knight", "longsword", s(26, 9, 6, 7, 2, 2, 1, 3, 3, 7, 3), ["steady"]),
    u("siege_mage", "Magus Orrin", "human", "stormcaller", "staff", s(18, 2, 4, 8, 3, 0, 8, 5, 3, 4, 4), ["smart"]),
    u("siege_cleric", "Chaplain Edda", "human", "cleric", "mace", s(22, 5, 4, 7, 2, 2, 3, 4, 7, 7, 4), ["loyal"]),
    u("siege_castellan", "Castellan Vey", "human", "sergeant", "longsword", s(34, 10, 7, 7, 3, 3, 1, 5, 4, 9, 4), ["brave"]),
    // ---------------- the foundry (constructs)
    u("golem", "Basalt Golem", "golem", "golem", "stone_fists", s(40, 12, 4, 5, 1, 3, 3, 0, 2, 10, 0), ["mindless"]),
    u("automaton_a", "Automaton I", "steamwork", "automaton", "piston", s(30, 10, 6, 7, 2, 2, 3, 0, 0, 10, 0), ["mindless"]),
    u("automaton_b", "Automaton II", "steamwork", "automaton", "piston", s(30, 10, 6, 7, 2, 2, 3, 0, 0, 10, 0), ["mindless"]),
    u("automaton_c", "Automaton III", "steamwork", "automaton", "piston", s(30, 10, 6, 7, 2, 2, 3, 0, 0, 10, 0), ["mindless"]),
    // ---------------- the marsh (lizard ambushers, mud)
    u("stalker_a", "Sandstalker", "lizardfolk", "sandstalker", "spear", s(24, 7, 7, 9, 5, 1, 1, 3, 2, 5, 3), ["cruel"]),
    u("stalker_b", "Sandstalker", "lizardfolk", "sandstalker", "spear", s(24, 7, 7, 9, 5, 1, 1, 3, 2, 5, 3), ["reckless"]),
    u("stalker_c", "Sandstalker", "lizardfolk", "sandstalker", "spear", s(24, 7, 7, 9, 5, 1, 1, 3, 2, 5, 3), ["smart"]),
    u("stalker_d", "Sandstalker", "lizardfolk", "sandstalker", "spear", s(24, 7, 7, 9, 5, 1, 1, 3, 2, 5, 3), ["cruel"]),
    u("mudling_a", "Mudling", "mudling", "mudling", "mud_slam", s(30, 8, 4, 5, 0, 1, 0, 0, 2, 10, 0), ["mindless"]),
    u("mudling_b", "Mudling", "mudling", "mudling", "mud_slam", s(30, 8, 4, 5, 0, 1, 0, 0, 2, 10, 0), ["mindless"]),
    // ---------------- harpies (flyers)
    u("harpy_a", "Shrike", "harpy", "swooper", "talons", s(16, 6, 6, 10, 6, 0, 0, 2, 2, 3, 3), ["cruel"]),
    u("harpy_b", "Gale-wing", "harpy", "swooper", "talons", s(16, 6, 6, 10, 6, 0, 0, 2, 2, 3, 3), ["reckless"]),
    // ---------------- beasts (packs)
    u("wolf_a", "Greyfang", "wolf", "hunter", "fangs", s(19, 7, 6, 9, 6, 0, 0, 2, 2, 4, 3), ["cruel"]),
    u("wolf_b", "Blackmaw", "wolf", "hunter", "fangs", s(19, 7, 6, 9, 6, 0, 0, 2, 2, 3, 3), ["cruel"]),
    u("wolf_c", "Scar", "wolf", "hunter", "fangs", s(19, 7, 6, 9, 6, 0, 0, 2, 2, 3, 3), ["cowardly"]),
    u("wolf_d", "Runt", "wolf", "hunter", "fangs", s(16, 6, 6, 10, 7, 0, 0, 2, 2, 2, 4), ["cowardly"]),
    u("wolf_f", "Hollow", "wolf", "hunter", "fangs", s(19, 7, 6, 9, 6, 0, 0, 2, 2, 4, 3), ["cruel"]),
    u("wolf_e", "Old Ash", "wolf", "hunter", "fangs", s(22, 8, 7, 8, 5, 0, 0, 3, 2, 6, 3), ["brave"]),
  ].map((d) => [d.id, d]),
);
