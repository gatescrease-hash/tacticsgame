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
2. Click a highlighted deploy tile to choose where your squad forms up; it arranges itself by role
   (melee in front, support in the middle, ranged behind). Untick units to bench them. The opening
   turn order updates as you go.
3. Press **Fight!** Your setup is simulated across 24 sample battles in a web worker; the
   difficulty settles the result from that win rate, and one of those battles is replayed at
   1x/2x/4x with HP bars, status tags, damage numbers, speech bubbles and a live turn-order bar.
4. The result depends only on your setup (roster, bench, where the squad forms up). Changing the
   seed shows a different battle with the same result.

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
- **Difficulty:** each scenario has an `enemyMods` modifier layer (`difficulty()` in
  `scenarios.ts`); fine-tune with its smooth `power` term rather than flat stats.
- **Combat rules** (`Rules` in `src/sim/state.ts`, overridable per battle) exist to tame tempo and
  difficulty sensitivity; see below.

## Status

All seven steps of the design notes' build order exist in a first-pass form:

1. [x] Text-log battle between two units
2. [x] Combat pipeline and modifier stack
3. [x] Utility AI (personality weights, threat map, doctrines, debug breakdown)
4. [x] Effects and triggers (abilities as data, statuses, passives, morale)
5. [x] Content data files with validation (typed TS objects + `validateContent`)
6. [x] Headless batch runner (win rates, length, damage share, ability use, tempo sensitivity)
7. [x] Visual playback (placement, bench, scouting, turn-order preview, bubbles, worker baking)

Batch snapshot (100 seeds, default setups): duel 7% player wins, skirmish 62%, patrol 60%,
foundry 65%, marsh 66%, wolves 50%; no draws.

## Sensitivity

`npm run sensitivity -- --detail` measures, per rules preset and scenario:

- **tempo:** player win % with a +30 opening-gauge head start minus win % at -30.
- **curve:** win % as enemy HP and damage step from -20% to +40%; **jump** is the biggest change
  between neighbouring steps, **mono** counts steps where a stronger enemy did *better*.
- **flip / ratio:** how often the winner changes when opening gauges are jittered, compared to
  2p(1-p), the rate for two unrelated battles. Ratio ~1 means a nudge is as good as a re-roll.

Findings that shaped the rules:

- The old "tempo sensitivity" number was mostly an artifact: one shared random stream meant any
  timing change reshuffled every later roll. That's why flips matched 2p(1-p) almost exactly.
- The real tempo effect pointed the *wrong way*: a head start made the player *lose*, by up to 78
  points in skirmish, because the side that steps into range first gets hit first.
- Rules added (all on by default; each one's contribution was checked by removing it):

| Rule | What it does | Mainly helps |
|---|---|---|
| `unitStreams` | each unit rolls from its own stream, fixed rolls per attack | readability, flip ratio |
| `hpScale: 150` | +50% HP for everyone; longer fights average out swings | tempo |
| `damageSpread: 20` | ±20% damage per hit blurs hits-to-kill breakpoints | cliffs |
| `charge` | stepping into range lets a unit strike that same turn (gauge debt) | tempo, cliffs |
| `underdog: 10` | a side down on knockouts takes 10% less damage per unit behind (max 3) | cliffs, snowballing |

Result on the five tuned scenarios (80 seeds per point):

| Rules | tempo (mean abs) | worst jump | wrong-way steps | flip ratio | battles/s |
|---|---|---|---|---|---|
| old (`BASELINE_RULES`) | 29 | 42 | 7 | 0.89 | 78 |
| new (`DEFAULT_RULES`) | 18 | 27 | 0 | 0.83 | 56 |

Difficulty curves are now monotonic and smoother, and the head-start effect is roughly 40% smaller.
Battles run about 50% longer and throughput drops accordingly.

## Robustness (placement and parity)

Goal: outcomes decided by *which* units you bring and how they're trained, not by the exact tile
you dropped them on or by streaks of dice; and an even fight should go to the player.
`npm run robustness` samples random placements x seeds per scenario plus mirror fixtures
(identical squads both sides); `--curve` prints each mirror's win % as enemy power runs -30..+30.

Extra rules (all off by default, see `Rules`): `formation` (squad arranges itself by role around
where you put it), `playerHold` (squad lets the enemy come), `luck: "meter"` (bounded luck: per-unit
meters, no streaks) or `hitDice: 2` (Fire Emblem true hit), `focusFire` (shared squad target),
`seededLuck: false` (meters start fixed: the seed changes nothing).

Findings so far:

- `formation` makes exact placement matter less in real scenarios (e.g. wolves with random
  placements: 33% -> 78% player wins).
- Mirror fights stay coin flips under every luck mode. The 20%->80% band is 20-30% enemy power wide
  (40-60% for 5v5), so even a 10% stronger side only wins ~70-80%.
- With luck fully fixed (no randomness at all), outcomes still swing with placement and are
  *non-monotonic* in enemy strength. The knife edge is deterministic chaos in the battle dynamics:
  every AI choice is an argmax, units re-decide every tile, kills compound. Dice smoothing alone
  can't fix it; tripling HP narrows the band only somewhat.
- AI commitment (`commitTarget`, multi-step move plans `stride`, squad `cohesion`) did not reduce
  the chaos; cohesion as implemented hurts (it drags archers and healers around). Diagnosis from a
  deterministic 2v2 mirror: equal units trade to within 1 HP (0/33 vs 1/33), so an even fight is a
  true tie that rounding or turn order breaks, and the first duel's winner snowballs. Ripostes make
  exchanges explosive, and the player-first initiative tie-break makes the player step into range
  first and eat the counter (a bias *against* the player at parity).
- Hold and focus fire shift the tipping point strongly for some compositions (3v3 with archer and
  healer: +30% enemy power to tip) but not others (melee 2v2, 5v5).

## Settled outcomes

`src/sim/settle.ts`. A battle's result is decided before you watch it:

1. The setup is simulated across 24 fixed sample seeds (so the result depends only on the setup).
2. The difficulty turns the player's win rate into a result: easy wins at >= 15%, normal at
   >= 35%, hard at >= 55%. (At exact parity the raw win rate is ~35-45%, because the player's side
   tends to step into range first, so normal sits at 35 to give even fights to the player.)
3. One of the samples with that result is replayed, chosen by margin: comfortable on easy
   (75th percentile of the winner's remaining HP), typical on normal, scrappy on hard. The seed box
   only varies which nearby battle is shown.

Every battle shown is a real, unaltered simulation; only the choice of which one is steered.
`npm run battle -- <scenario> <seed> --settle normal` and `npm run robustness -- --settle` exercise it.

Parity, measured on truly symmetric mirrors (`npm run robustness -- --parity`: the enemy stands on
the reflection of the player's formed squad), player win % mean over placements:

| Squad | even | enemy +10% | +20% | +30% |
|---|---|---|---|---|
| 2 melee | 54 | 29 | 21 | 21 |
| 2 ranged | 86 | 73 | 41 | 17 |
| 3 mixed | 69 | 22 | 13 | 1 |
| 3 skirmishers | 53 | 33 | 8 | 7 |
| 4 mixed | 52 | 53 | 34 | 4 |
| 5 mixed | 49 | 36 | 33 | 25 |

Even fights already lean to the player (the enemy doctrine is a little more aggressive, so the enemy
walks in). Normal's 35% threshold sits between "even" and "clearly stronger" for every
composition. (An earlier version of this table showed even fights at 33-42%; that came from a
lopsided fixture where only the player's squad formed up.)

## Run model

`npm run runs -- table <scenario>` precomputes settled results per enemy strength level and play
style; `npm run runs -- model --ramp R` then simulates whole runs instantly: scenarios in shuffled
order, enemy strength rising R% per battle (net of player growth, which doesn't exist yet),
5 hearts, a loss costing 1-3 hearts by how badly it went.

Median battles survived [10th-90th percentile], battle win %:

| ramp | normal, typical play | normal, thoughtful play | easy, typical play |
|---|---|---|---|
| 1%/battle | 12 [9-15], 77% | 20 [17-23], 85% | |
| 2%/battle | 9 [6-11], 66% | 13 [11-15], 76% | 13 [10-15], 83% |
| 3%/battle | 7 [6-9], 60% | 11 [9-11], 70% | 10 [7-12], 78% |

(typical = full roster dropped at a random spot; thoughtful = best of six such setups per fight.)

Findings:

- Winning is the norm and thoughtful play goes much further, as intended: at a net ramp of ~1% per
  battle, normal runs last ~12 battles for typical play and ~20 for thoughtful play.
- **Missing a unit is never a small mistake.** Benching one or two units drops the win rate from
  ~75% to ~2%: fights follow Lanchester's square law, so numbers dominate. "Small mistakes" will
  have to come from roster and training choices worth a few % of strength each, not from bodies.
- Each +5% of net enemy strength costs ~10-15 points of win rate, so a run ends fairly
  predictably once strength passes the player's level ("the wall"), with a narrow spread of run
  lengths. Real compounding needs the progression systems, so mistakes carry between battles.

## Known issues and next steps

- **Scenarios represent early-run fights.** At +0% enemy strength they settle as wins on normal for
  typical play (skirmish is the exception at a 54% raw rate). Difficulty is meant to come from a
  run's ramp; there is no run loop yet, only the model above.
- Settling costs 24 battles per Fight (about 0.9 s for patrol in the browser).

- **Tempo is still knife-edge in small fights.** Skirmish (2v2) still swings 44 points on a
  ±30 head start, and jittered openings still flip about as often as a re-roll would (ratio
  ~0.8), meaning the AI dynamics themselves are chaotic. Ideas not yet tried: AI that values
  "let them come to me" explicitly (tempo-aware danger), simultaneous resolution of same-tick
  actions, or smaller per-tile movement costs.
- **Throughput:** about 40–50 µs per unit turn; with the longer default fights, 30–50 ten-unit
  battles per second per core.
  Fine for now; profile before building map generation (`ai.ts` position scoring and pathing
  are the hot spots).
- Not built yet: smart-unit lookahead, interactables, "being caught" as a state, shields as
  items, the home phase, training, class trees, the roguelike loop, map generation.
- All numbers in `src/content` are placeholders.
