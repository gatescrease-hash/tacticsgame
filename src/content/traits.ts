import type { Reason, TraitDef } from "../sim/types.js";

/**
 * Traits are emergent, not good or bad: a coward just keeps away from danger,
 * which makes a poor front-liner and a fine archer.
 */
export const traits = {
  brave: {
    id: "brave", name: "Brave", weights: { danger: -4, aggression: 3 }, resolve: 4, passives: ["vengeance"],
    lines: { advance: ["Forward!", "With me!"], steady: ["I've had worse."], hold: ["I'll hold here."] },
  },
  cowardly: {
    id: "cowardly", name: "Cowardly", weights: { danger: 10, aggression: -4 }, resolve: -4, passives: ["panic"],
    lines: { retreat: ["Nope, nope, nope!", "Too close!", "I'm better back here!"], shaken: ["I can't do this!"] },
  },
  reckless: {
    id: "reckless", name: "Reckless", weights: { danger: -5, aggression: 5, tempo: -3 }, resolve: 0, onBreak: "frenzy",
    lines: { advance: ["Let's go!"], frenzy: ["Is that all you've got?!"], finish: ["Mine!"] },
  },
  smart: {
    id: "smart", name: "Smart", weights: { kill: 6, aoe: 4, danger: 1 }, resolve: 2,
    lines: { finish: ["Take the weak one first."], aoe: ["They're bunched up."], retreat: ["Repositioning."] },
  },
  dim: {
    id: "dim", name: "Dim", weights: { kill: -6, aoe: -6, support: -4, danger: -2 }, resolve: 2,
    lines: { attack: ["Hit thing."], advance: ["Go that way."] },
  },
  loyal: {
    id: "loyal", name: "Loyal", weights: { support: 6 }, resolve: 3,
    lines: { support: ["Hold on, I'm coming!", "Stay with me!"] },
  },
  steady: { id: "steady", name: "Steady", weights: {}, resolve: 5, lines: { steady: ["Steady."] } },
  cruel: {
    id: "cruel", name: "Cruel", weights: { kill: 8, aggression: 2 }, resolve: 1, passives: ["last_stand"],
    lines: { finish: ["Finish it."] },
  },
  mindless: {
    id: "mindless", name: "Mindless", weights: { danger: -6, aggression: 6, support: -8 }, resolve: 0,
    lines: { advance: ["*grinding gears*"], attack: ["*hiss of steam*"] },
  },
} satisfies Record<string, TraitDef>;

/** Default speech lines when no trait has its own. */
export const voice: Partial<Record<Reason, string[]>> = {
  advance: ["Moving up.", "Closing in."],
  retreat: ["Falling back!", "Pulling back."],
  finish: ["Finishing this!", "Going down!"],
  aoe: ["Clear them out!"],
  support: ["I've got you."],
  rally: ["Rally!"],
  shaken: ["This is bad...", "Too many of them!"],
  frenzy: ["Raaagh!"],
  steady: ["Hold firm."],
  counter: ["Riposte!"],
};
