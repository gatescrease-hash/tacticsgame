# Tactics Autobattler

A tactical RPG autobattler: Fire Emblem / Final Fantasy Tactics class depth, D&D-style combat
logic, autochess-style hands-off battles. The player's whole job is setup; units fight on their own.

Design notes: [Tactics Autobattler: Design Notes](https://claude.ai/artifact/G9fSJf5VyuY8fcwm2ibHku)

## Quick start

Requires Node 20+.

```sh
npm install
npm run dev                              # play in the browser at http://localhost:5173
npm run battle -- patrol 7               # one battle as a text log (scenario, seed)
npm run battle -- patrol 7 --debug       # ...plus the AI's candidate scores for every decision
npm run batch -- all 200                 # headless balance report for every scenario
npm test                                 # vitest
npm run typecheck                        # also checks the sim has no DOM/Node dependencies
```

## Playing the demo

1. Pick a scenario. Read the scouting report: a general picture of the enemy, not every detail.
2. Click one of your units, then a highlighted deploy tile to move it (click another unit to swap).
   Untick units to bench them. The opening turn order updates as you go.
3. Press **Fight!** The whole battle is simulated in a web worker, then replayed at 1x/2x/4x with
   HP bars, status tags, damage numbers, speech bubbles and a live turn-order bar.
4. Change the seed or your setup and try again. Same setup + same seed = the same battle.

Scenarios: `duel`, `skirmish`, `patrol` (Arago militia, textbook formation), `foundry` (golem and
automatons: fire and minds don't work), `marsh` (lizardfolk ambush plus mudlings that water
dissolves), `wolves` (a pack that goes for stragglers).

## How the simulation works

```
src/sim/             Pure, deterministic simulation. No DOM, no Node APIs (tsconfig.sim.json).
  types.ts           Content defs (races, classes, weapons, abilities, statuses...) and runtime Unit.
  battle.ts          Unit creation (stat layers), setup, main loop, turn handling, commander layer.
  clock.ts           Initiative gauges: fill by fillRate, act at 100, subtract action cost.
  stats.ts           Modifier stack: base -> flat -> percent -> caps. Derived values (hit, dodge...).
  combat.ts          Abilities: targeting shapes, staged pipeline aim -> reaction -> armour -> effect.
  damage.ts          Damage packets per component; material tiers; pillars; creature profiles.
  statuses.ts        Build-up meters, apply/expire, damage over time.
  effects.ts         HP loss, knockouts, morale checks, speech, trigger dispatch (passives).
  ai.ts              Utility AI: candidates x weighted considerations; personality = weights.
  grid.ts            Map tiles, Dijkstra pathing (binary heap), line of sight.
  validate.ts        Content validation.
  log.ts, format.ts  The battle log (the sim's only output) and its text rendering.
src/content/         All game data as typed TS objects (hot-reloads in the dev server).
src/cli/             Node entry points: single battle, batch runner.
src/tools/stats.ts   Batch aggregation (win rates, damage share, ability use, KO rates).
src/web/             Setup screen, web-worker baking, canvas playback.
tests/               Vitest tests.
```

Key mechanics, briefly:

- **Turn order:** each unit's gauge fills by its fill rate (Speed, soft-capped, slowed by heavy armour
  unless Strength carries it). At 100 it acts and pays the action's cost; moving costs gauge per tile.
  Units move one tile per action and re-decide between steps.
- **Combat:** aim (hit) → reaction (dodge, parry, block) → armour (per damage component:
  (power − mitigation) × tier) → effect (riders such as build-up). Crits halve mitigation.
- **Damage:** physical types vs armour materials, plus energy (fire, lightning, light), mind (psychic) and
  spirit pillars, each reading a different part of the creature profile. Hybrids such as Emberblade
  split into components. Interactions: wet + lightning conducts, wind spreads burning, water dissolves mud.
- **Statuses build up, not roll:** hits fill meters (resisted by a stat); burning, poison, bleed,
  stun, wet, shaken, frenzy, rallied, haste, slow.
- **Passives on triggers:** riposte (counter when attacked), engage (free hit on disengage), poison
  blade, vengeance/panic when an ally falls, last stand. Morale checks at 50% and 25% HP use Resolve
  plus traits.
- **AI:** each turn scores using abilities from here, holding, and stepping to each neighbour, all
  using one position value (best reachable action, discounted by distance) minus danger. Danger
  is a threat map: what enemies could do to this tile before my next turn, shared across their
  possible targets. Traits shift weights (cowards weigh danger, smart units weigh kills and AoE).
  Impatience and battle pressure erode caution so standoffs end. Doctrines (advance, hold/ambush,
  hunt a class tag, pack) set enemy intent and target priorities.
- **Difficulty:** each scenario has an `enemyMods` modifier layer, tuned with the batch runner.

## Status

All seven steps of the design notes' build order exist in a first-pass form:

1. [x] Text-log battle between two units
2. [x] Combat pipeline and modifier stack
3. [x] Utility AI (personality weights, threat map, doctrines, debug breakdown)
4. [x] Effects and triggers (abilities as data, statuses, passives, morale)
5. [x] Content data files with validation (typed TS objects + `validateContent`)
6. [x] Headless batch runner (win rates, length, damage share, ability use, tempo sensitivity)
7. [x] Visual playback (placement, bench, scouting, turn-order preview, bubbles, worker baking)

Batch snapshot (100 seeds, default setups): duel 8% player wins, skirmish 67%, patrol 75%,
foundry 57%, marsh 87%, wolves 83%; no draws.

## Known issues and next steps

- **Tempo sensitivity is high.** Jittering opening gauges by up to 20 flips the winner in roughly
  25–50% of seeds in most scenarios. This is the "knife-edge" problem from the design notes; the
  batch runner measures it so it can be tuned against.
- **Difficulty has cliffs.** Small enemy stat changes can swing win rates a lot, because the side
  that walks into range first tends to lose. Mirror matches: holding beats advancing.
- **Throughput:** about 40–50 µs per unit turn, so 35–80 ten-unit battles per second per core.
  Fine for now; profile before building map generation (`ai.ts` position scoring and pathing
  are the hot spots).
- Not built yet: smart-unit lookahead, interactables, "being caught" as a state, shields as
  items, the home phase, training, class trees, the roguelike loop, map generation.
- All numbers in `src/content` are placeholders.
