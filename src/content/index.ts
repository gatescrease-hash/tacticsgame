import type { Content } from "../sim/types.js";
import { abilities, passives } from "./abilities.js";
import { classes } from "./classes.js";
import { trinkets, weapons } from "./gear.js";
import { races } from "./races.js";
import { scenarios } from "./scenarios.js";
import { statuses } from "./statuses.js";
import { traits, voice } from "./traits.js";
import { units } from "./units.js";

/**
 * All game content, as typed data. Checked at runtime by validateContent
 * (unknown ids, missing stats, bad maps); the dev server hot-reloads edits.
 */
export const content: Content = { races, classes, weapons, trinkets, statuses, abilities, passives, traits, units, scenarios, voice };

export const scenarioIds = Object.keys(scenarios);
