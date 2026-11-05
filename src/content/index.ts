import type { Content } from "../sim/types.js";
import { classes } from "./classes.js";
import { scenarios } from "./scenarios.js";
import { units } from "./units.js";
import { weapons } from "./weapons.js";

/**
 * All game content. Typed TS objects for now; schema-checked JSON and
 * validation (unknown tags, missing stats) arrive with build step 5.
 */
export const content: Content = { classes, weapons, units, scenarios };

export type ScenarioId = keyof typeof scenarios;
export const scenarioIds = Object.keys(scenarios) as ScenarioId[];
