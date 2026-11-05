import type { StatusDef } from "../sim/types.js";

export const statuses = {
  burning: {
    id: "burning", name: "Burning", short: "Bu", threshold: 100, duration: 40,
    dot: { damage: 2, every: 10 }, removes: ["wet"], immuneTags: ["stone", "mud"], resistStat: "arcana",
  },
  poisoned: {
    id: "poisoned", name: "Poisoned", short: "Po", threshold: 100, duration: 60,
    dot: { damage: 2, every: 12 }, immuneTags: ["construct", "mud"], resistStat: "spirit",
  },
  bleeding: {
    id: "bleeding", name: "Bleeding", short: "Bl", threshold: 100, duration: 30,
    dot: { damage: 3, every: 10 }, immuneTags: ["construct", "mud"],
  },
  wet: {
    id: "wet", name: "Soaked", short: "We", threshold: 100, duration: 50, removes: ["burning"],
  },
  stunned: {
    id: "stunned", name: "Stunned", short: "St", threshold: 100, duration: 18, freezesGauge: true, resistStat: "resolve",
  },
  shaken: {
    id: "shaken", name: "Shaken", short: "Sh", threshold: 100, duration: 60,
    mods: [{ key: "hit", op: "flat", value: -10 }], tags: ["fear"], resistStat: "resolve",
  },
  frenzy: {
    id: "frenzy", name: "Frenzied", short: "Fr", threshold: 100, duration: 60,
    mods: [{ key: "strength", op: "flat", value: 3 }, { key: "dodge", op: "flat", value: -10 }], tags: ["frenzy"],
  },
  rallied: {
    id: "rallied", name: "Rallied", short: "Ra", threshold: 100, duration: 60,
    mods: [{ key: "hit", op: "flat", value: 10 }, { key: "resolve", op: "flat", value: 4 }], removes: ["shaken"],
  },
  hasted: {
    id: "hasted", name: "Hasted", short: "Ha", threshold: 100, duration: 40,
    mods: [{ key: "fillRate", op: "pct", value: 40 }],
  },
  slowed: {
    id: "slowed", name: "Slowed", short: "Sl", threshold: 100, duration: 40,
    mods: [{ key: "fillRate", op: "pct", value: -40 }],
  },
} satisfies Record<string, StatusDef>;
