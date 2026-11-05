import type { AbilityDef, PassiveDef } from "../sim/types.js";

/**
 * Abilities are data: effect pieces + a targeting shape + cost + cooldown.
 * Cooldowns are in ticks (a typical turn is ~10-15 ticks).
 */
export const abilities = {
  shield_bash: {
    id: "shield_bash", name: "Shield Bash", cost: 110, cooldown: 50,
    range: { min: 1, max: 1 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "attack",
    effects: [
      { kind: "damage", packet: [{ type: "bludgeoning", share: 100 }], power: { weapon: true, scale: 60, base: 0 } },
      { kind: "buildup", status: "stunned", amount: 70 },
    ],
    tags: ["melee", "suppress"],
  },
  war_cry: {
    id: "war_cry", name: "War Cry", cost: 80, cooldown: 150,
    range: { min: 0, max: 0 }, target: "self", shape: { kind: "radius", r: 2 }, affects: "allies", check: "auto",
    effects: [{ kind: "status", status: "rallied" }],
    tags: ["buff"], aiValue: 12, say: ["Hold the line!", "Steady, lads!"],
  },
  piercing_shot: {
    id: "piercing_shot", name: "Piercing Shot", cost: 110, cooldown: 50,
    range: { min: 2, max: 5 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "attack",
    effects: [{ kind: "damage", packet: [{ type: "piercing", share: 100 }], power: { weapon: true, base: 4 } }],
    tags: ["ranged"],
  },
  firebolt: {
    id: "firebolt", name: "Firebolt", cost: 100, cooldown: 0,
    range: { min: 2, max: 4 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "auto",
    effects: [
      { kind: "damage", packet: [{ type: "fire", share: 100 }], power: { stat: "arcana", base: 4 } },
      { kind: "buildup", status: "burning", amount: 45 },
    ],
    tags: ["ranged", "spell"],
  },
  flame_nova: {
    id: "flame_nova", name: "Flame Nova", cost: 150, cooldown: 120,
    range: { min: 1, max: 3 }, target: "enemy", shape: { kind: "radius", r: 1 }, affects: "enemies", check: "auto",
    effects: [
      { kind: "damage", packet: [{ type: "fire", share: 100 }], power: { stat: "arcana", base: 6 } },
      { kind: "buildup", status: "burning", amount: 70 },
    ],
    tags: ["aoe", "spell"], say: ["Flame Nova!", "Burn!"],
  },
  tide_lash: {
    id: "tide_lash", name: "Tide Lash", cost: 100, cooldown: 30,
    range: { min: 1, max: 3 }, target: "enemy", shape: { kind: "line", length: 3 }, affects: "enemies", check: "auto",
    effects: [
      { kind: "damage", packet: [{ type: "bludgeoning", element: "water", share: 100 }], power: { stat: "arcana", base: 3 } },
      { kind: "status", status: "wet" },
    ],
    tags: ["spell"],
  },
  chain_lightning: {
    id: "chain_lightning", name: "Chain Lightning", cost: 120, cooldown: 60,
    range: { min: 2, max: 4 }, target: "enemy", shape: { kind: "radius", r: 1 }, affects: "enemies", check: "auto",
    effects: [{ kind: "damage", packet: [{ type: "lightning", share: 100 }], power: { stat: "arcana", base: 4 } }],
    tags: ["aoe", "spell"], say: ["Feel the storm!"],
  },
  gale: {
    id: "gale", name: "Gale", cost: 100, cooldown: 60,
    range: { min: 1, max: 3 }, target: "enemy", shape: { kind: "radius", r: 1 }, affects: "enemies", check: "auto",
    effects: [
      { kind: "damage", packet: [{ type: "slashing", element: "wind", share: 100 }], power: { stat: "arcana", scale: 60, base: 2 } },
      { kind: "push", tiles: 1 },
    ],
    tags: ["aoe", "spell"],
  },
  mend: {
    id: "mend", name: "Mend", cost: 100, cooldown: 25,
    range: { min: 0, max: 3 }, target: "ally", shape: { kind: "single" }, affects: "allies", check: "auto",
    effects: [{ kind: "heal", power: { stat: "spirit", base: 6 } }],
    tags: ["heal", "spell"],
  },
  smite: {
    id: "smite", name: "Smite", cost: 100, cooldown: 40,
    range: { min: 1, max: 3 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "auto",
    effects: [{ kind: "damage", packet: [{ type: "spirit", share: 100 }], power: { stat: "spirit", base: 5 } }],
    tags: ["spell"],
  },
  mind_spike: {
    id: "mind_spike", name: "Mind Spike", cost: 90, cooldown: 30,
    range: { min: 1, max: 4 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "auto",
    effects: [
      { kind: "damage", packet: [{ type: "psychic", share: 100 }], power: { stat: "mind", base: 4 } },
      { kind: "buildup", status: "shaken", amount: 60 },
    ],
    tags: ["spell"],
  },
  negate_turn: {
    id: "negate_turn", name: "Negate Turn", cost: 70, cooldown: 90,
    range: { min: 1, max: 4 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "auto",
    effects: [{ kind: "gauge", amount: -60 }],
    tags: ["spell"],
  },
  crushing_blow: {
    id: "crushing_blow", name: "Crushing Blow", cost: 150, cooldown: 80,
    range: { min: 1, max: 1 }, target: "enemy", shape: { kind: "radius", r: 1 }, affects: "enemies", check: "attack",
    effects: [
      { kind: "damage", packet: [{ type: "bludgeoning", share: 100 }], power: { weapon: true, base: 2 } },
      { kind: "push", tiles: 1 },
    ],
    tags: ["melee", "aoe"],
  },
  piston_slam: {
    id: "piston_slam", name: "Piston Slam", cost: 120, cooldown: 60,
    range: { min: 1, max: 1 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "attack",
    effects: [
      { kind: "damage", packet: [{ type: "bludgeoning", share: 100 }], power: { weapon: true, base: 2 } },
      { kind: "buildup", status: "stunned", amount: 60 },
    ],
    tags: ["melee", "suppress"],
  },
  pounce: {
    id: "pounce", name: "Pounce", cost: 80, cooldown: 40,
    range: { min: 1, max: 1 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "attack",
    effects: [
      { kind: "damage", packet: [{ type: "piercing", share: 100 }], power: { weapon: true, base: 1 } },
      { kind: "buildup", status: "bleeding", amount: 70 },
    ],
    tags: ["melee"],
  },
  dive: {
    id: "dive", name: "Dive", cost: 110, cooldown: 60,
    range: { min: 1, max: 1 }, target: "enemy", shape: { kind: "single" }, affects: "enemies", check: "attack",
    effects: [
      { kind: "damage", packet: [{ type: "piercing", share: 100 }], power: { weapon: true, base: 4 } },
      { kind: "push", tiles: 1 },
    ],
    tags: ["melee"], say: ["From above!"],
  },
} satisfies Record<string, AbilityDef>;

/** Passives dominate: reliable without player input. */
export const passives = {
  riposte: {
    id: "riposte", name: "Riposte", trigger: "onBeingAttacked", counter: true, say: ["Too slow!", "My turn."],
  },
  engage: {
    id: "engage", name: "Engage", trigger: "onEnemyDisengage", counter: true, say: ["Not so fast!", "Running?"],
  },
  poison_blade: {
    id: "poison_blade", name: "Poison blade", trigger: "onHit", effectTarget: "other",
    effects: [{ kind: "buildup", status: "poisoned", amount: 40 }],
  },
  keen_eye: { id: "keen_eye", name: "Keen eye", mods: [{ key: "hit", op: "flat", value: 5 }] },
  shield_wall: { id: "shield_wall", name: "Shield wall", mods: [{ key: "block", op: "flat", value: 15 }] },
  vengeance: {
    id: "vengeance", name: "Vengeance", trigger: "onAllyKnockedOut", effectTarget: "self",
    effects: [{ kind: "status", status: "rallied" }], say: ["For them!", "You'll pay for that!"],
  },
  panic: {
    id: "panic", name: "Panic", trigger: "onAllyKnockedOut", effectTarget: "self",
    effects: [{ kind: "buildup", status: "shaken", amount: 80 }], say: ["They got them! We're next!"],
  },
  last_stand: {
    id: "last_stand", name: "Last stand", trigger: "onHpBelow25", once: true, effectTarget: "self",
    effects: [{ kind: "status", status: "hasted" }], say: ["Not yet!"],
  },
} satisfies Record<string, PassiveDef>;
