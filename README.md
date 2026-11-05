# Tactics Autobattler

A tactical RPG autobattler: Fire Emblem / Final Fantasy Tactics class depth, D&D-style combat
logic, autochess-style hands-off battles. The player's whole job is setup; units fight on their own.

Design notes: [Tactics Autobattler: Design Notes](https://claude.ai/artifact/G9fSJf5VyuY8fcwm2ibHku)

## Quick start

Requires Node 20+.

```sh
npm install
npm run dev                      # browser playback at http://localhost:5173
npm run battle -- duel 7         # one battle as a text log (scenario, seed)
npm run batch -- skirmish 1000   # headless batch: win rates, length, damage share
npm test                         # vitest
npm run typecheck                # also checks the sim has no DOM/Node dependencies
```

## Layout

```
src/sim/       Pure, deterministic simulation. No DOM, no Node APIs.
  rng.ts       Seeded integer RNG (mulberry32). Never use Math.random in the sim.
  grid.ts      Tiles (blocked / swamp), pathfinding.
  clock.ts     Initiative gauges: fill by speed, act at 100, subtract action cost.
  combat.ts    Staged pipeline: aim -> reaction -> armour -> effect.
  ai.ts        Placeholder brain (walk into range, hit weakest). Utility AI comes next.
  battle.ts    Setup + main loop; produces the battle log.
  log.ts       Battle log event types: the sim's only output.
  format.ts    Text rendering of the log.
src/content/   Classes, weapons, preset units, hand-authored scenarios (typed TS data).
src/cli/       Node entry points: single battle, batch runner.
src/web/       Browser playback that reads the log.
tests/         Vitest tests.
```

## Status

Following the design notes' build order:

1. [x] Text-log battle between two units (plus a 2v2 scenario)
2. [ ] Combat pipeline and modifier stack (a first-pass pipeline exists; no modifier stack yet)
3. [ ] Utility AI
4. [ ] Effects and triggers
5. [ ] Content data files with validation
6. [~] Headless batch runner (basic version in `src/cli/batch.ts`)
7. [~] Visual playback (placeholder canvas in `src/web`)

All numbers in `src/content` are placeholders; expect them to be wildly unbalanced.
