# Tactics Autobattler

A tactical RPG autobattler: Fire Emblem / Final Fantasy Tactics class depth, D&D-style combat
logic, autochess-style hands-off battles. The player's whole job is setup; units fight on their own.

Design notes: [Tactics Autobattler: Design Notes](https://claude.ai/artifact/G9fSJf5VyuY8fcwm2ibHku)

Play it: https://gatescrease-hash.github.io/tacticsgame/ (built and deployed from `main` by
`.github/workflows/pages.yml`).

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
   Battles play in a 2.5D view by default (header: View 3D/2D): drag to rotate and tilt, scroll
   to zoom.
4. The result depends only on your setup (roster, bench, where the squad forms up). Changing the
   seed shows a different battle with the same result.

**Runs:** press **Start run** for the roguelike loop (difficulty and seed come from the header). You
start with a company of five. Each battle you tick who deploys (the map limits how many) and choose
where they form up; enemy strength rises 5% per battle. Afterwards deployed units gain XP (knocked-out
units half, and they're fatigued next fight), and you pick a reward: a recruit, training, a trinket,
or rest (+1 heart). Losses cost 1-3 hearts by how badly they went; at 0 the run is over.

Scenarios (all have elevation now): `cliffs` (crossbows on a 2 m bluff, a chasm of pits, leaping wolves,
harpies), `duel`, `skirmish`, `patrol` (Arago militia, textbook formation), `foundry` (golem and
automatons: fire and minds don't work), `marsh` (lizardfolk ambush plus mudlings that water
dissolves), `wolves` (a pack that goes for stragglers).

## Tuning panel

Under the board, **Tuning** exposes every balance dial the browser can reach, each showing its
default (read from the sim's own constants) with a ↺ reset: pacing (action cost, HP, move cost,
hold cost, damage spread), courage and aggression (nerve, forward pressure, impatience, battle
pressure, enemy push, player hold), the base AI weights every unit starts from, team play
(formation, focus fire, commitment, stride, cohesion), fairness and luck, enemy power and timeout,
settling (settled vs **raw** single-seed battles, samples, per-difficulty thresholds and shown
margin), run ramp and hearts, and playback timing per event. Changes apply to the next Fight;
Enter in a field (or **Fight again** during a battle) re-bakes at once. After each battle a
**Pacing** line summarises how it looked (turn mix, ping-pong, average hit, actions per unit,
first blood, length; the same numbers as `npm run pacing`). Only changed values are stored (in
this browser), and **Copy JSON** / **Paste JSON** move a set of changes around, e.g. to paste back
into a chat so the values can become the new defaults. Rule keys map 1:1 onto `Rules`
(`src/sim/state.ts`); new rules: `moveScale`, `waitCost`, `impatience`, `pressureStart`,
`pressureSpan`, `doctrinePush`, `baseWeights` (previously hard-coded, same defaults), and the
**Commitment** group (`commit`, `commitBreak`, `retreatLimit`).

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
src/web/             Setup screens, web-worker baking, playback (2D canvas or render3d.ts).
src/run/             The roguelike run loop (pure TS).
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
  Impatience and battle pressure erode caution so standoffs end. Pacing rules (see "Pacing") make
  healthy units press forward and stop them ping-ponging between two tiles. Doctrines (advance, hold/ambush,
  hunt a class tag, pack) set enemy intent and target priorities.
- **Elevation and pits** (`src/sim/movement.ts`, `grid.ts`, `combat.ts`): a scenario may give ground
  heights in whole metres (`heights`, digits per tile). Stepping up 1 m costs +50% movement; climbing
  more than your jump height (1 m; 2 m for skirmishers, duelists, sandstalkers and wolves) is
  impossible; dropping is fine up to jump + 1 m. Melee only connects across 1 m of height (reach
  weapons: their range in metres), so a swordsman under a 2 m cliff can't touch the archer on top.
  Ranged attacks and spells get +/-10% damage per metre of height advantage (max 20%) and +1 range
  from 2 m up; terrain 2 m above both ends of a sight line blocks it. Pits (`O`) have no footing
  and don't block sight: jumpers leap a single pit tile, flyers (race move tag) cross freely, and
  anyone pushed into one falls and is knocked out. Flyers (winged folk, harpies) ignore height and
  pits, hover over the board, swoop in melee at any height, and can't be knocked into a pit. The AI plans through the same rules, values high
  ground for ranged units, and discounts melee threats that can't climb to it.
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
| `hpScale: 150` | +50% HP for everyone; longer fights average out swings (now 250, see Pacing) | tempo |
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

## Pacing

Feedback from watching: units looked cowardly, hovering at the edge of each other's reach. `npm run
pacing -- [scenario|all] [runs] [--rules '{json}']` measures how turns are spent: acting, stepping
toward / away from the nearest enemy, waiting, and "flip" (stepping straight back to the tile just
left), plus the average hit as % of the target's max HP. Rules added (all in `DEFAULT_RULES`):

| Rule | What it does |
|---|---|
| `actionScale: 60` + `hpScale: 250` | abilities cost 60% of the gauge (cooldowns, build-up and gauge effects scale with them) while HP is 1.67x: more, smaller actions at the same damage per tick. Damage over time is scaled up to match. |
| `nerve: 40` | healthy units weigh danger at 40% of normal, rising to 100% at half HP (archers, mages and healers keep at least 70%). Wounded units still fall back. |
| `advance: 6` | until it has something in reach, a step along the way to a target is worth 6 x aggression/10 (half for the back line), and stepping straight back onto the tile just left costs twice that unless the unit was hurt since (holding a turn resets it). |

All scenarios, 40 seeds each:

| | act | step toward | step away | wait | flip | avg hit | actions / unit / 100 ticks |
|---|---|---|---|---|---|---|---|
| before | 10% | 42% | 31% | 15% | 29% | 34% of max HP | 1.1 |
| after | 25% | 37% | 25% | 11% | 7% | 20% of max HP | 2.3 |
| + commitment | 29% | 35% | 19% | 13% | 6% | 19% of max HP | 3.1 |

**Commitment and the retreat clock** (second pass, so units have no reason to hover):

| Rule | What it does |
|---|---|
| `commit: 3` | a unit that starts backing off (reposition) keeps it up for 3 steps and never steps closer meanwhile; a melee unit that starts advancing (engage) keeps closing on its target, by walking distance, until it attacks (at most 12 turns), never stepping back and holding only when the way is blocked. Losing 25% of max HP (`commitBreak`) or the target falling frees it to rethink. Archers, mages and healers aren't held to an advance: holding at the edge of range is their right play, and forcing it handed ranged mirror fights to whoever moved second (player median 4%). |
| `retreatLimit: 60` | every turn that neither acts nor closes on the enemy runs a clock; after 60 ticks the unit shouts ("Enough running!") and charges with no caution and no holding until it acts. Any ability (heals too) resets it. |

The debug log (`npm run battle -- <scenario> <seed> --debug`) shows each unit's commitment as
`[engage 9]`, `[reposition 2]` or `[forced]`. With cautious settings (`nerve: 100, advance: 0`)
commitment alone cuts ping-pong from 24% to 6% of turns. The clock rarely fires at the defaults
(courage and forward pressure already keep units moving; ~2-7% of decisions with cautious
settings): it is a backstop. Waits rose because a blocked engaging unit now holds instead of
shuffling; it's most visible in the cramped foundry. Fights are ~25% shorter, and the value of a
±30 head start (sensitivity "tempo") is now about 0 on every tuned scenario. Scenario power was
retuned again against the run roster (see Run loop).

Parity cost: the mirror fixtures in `npm run robustness -- --settle` (identical squads) got
noisier. At +0% the share of placements settling as a player win on normal is 2 ranged 50%,
3 mixed 40%, 3 skirm 100%, 4 mixed 70%, 5 mixed 70% (before commitment: 80 / 80 / 100 / 80 / 70);
every small AI change reshuffles these (exact parity is decided by who acts first). All real
scenarios still settle as wins from every placement. `--rules '{json}'` on robustness compares
rule variants.

The biggest single finding was the ping-pong: about 30% of all turns were a unit stepping back
onto the tile it had just left, as its best "spot to act from" flipped while enemies moved. The
remaining steps away are mostly flanking (wolves circling to isolated targets), kiting by archers
and crossbows, and wounded units retreating.

Side effects: difficulty curves got steeper (a stronger enemy wins more reliably: less noise), and
every scenario had to be retuned. Scenario `power` is now tuned against the run's starting roster
at its default spot (`npm run tune-roster`, target ~85% settled at +0%), since runs are the main
mode; the preset single battles became easier (median settled 88-96%). `npm run tune -- <scenario>`
does the same for preset squads over random placements. Sensitivity (`--presets default,old-pacing`
on the retuned scenarios): head-start value mean |5| points (marsh 23), flip ratio 0.91,
throughput 56 battles/s (up from 44: fights are shorter).

## Archetypes and tactics

Every class has a battlefield **role** (`role` in `classes.ts`), and every unit a **tactics** value
(0-100): how well it plays that role. Tactics starts at 40 (beasts 20), traits shift it (smart
+30, steady +15, loyal/cruel +5, cowardly -5, reckless/dim -30, mindless -100) and run training
raises it (+20 per "Train X: +20 tactics" reward). The roster lists both ("flanker · tactics 10").
At tactics 0 a unit just brawls, exactly as before. Role behaviour scales with tactics:

| Role | Classes | Behaviour |
|---|---|---|
| vanguard | knight, spearman, sergeant | before contact, doesn't run more than 2 tiles ahead of the squad; prefers enemies threatening its own back line (peel) |
| flanker | skirmisher, duelist, sandstalker, wolf, harpy, skyguard | at tactics 30+, a flanking run: before its front line makes contact, works toward the nearest enemy archer/caster/healer along a route that bends around enemy front-liners' reach, and stops short of anyone's reach; then goes in. Prefers fragile targets, avoids front-liners. Waiting for contact doesn't run the retreat clock. A flanker with no front line of its own (a duel) goes straight in |
| marksman | archer, crossbowman, pyromancer, stormcaller, tactician | before contact, stays behind its front line; prefers fragile targets |
| medic | cleric | before contact, stays behind its front line |
| brute | brute, golem, automaton, mudling | no plan |

The motivating case: in the Arago patrol, reckless Kesh (tactics 10) charges in and is knocked
out at tick ~19 every time. Trained (+60 tactics) he flanks: knocked out at tick ~85 on average
(often surviving), with three times the damage, most of it on the crossbowmen.

`npm run tactics -- [scenario|all] [runs] [--levels 10,25,40] [--bonus 60]` checks that smarter play
pays: player win % as enemy power rises, with the squad brawling (tactics 0), natural, and +60.
At +10/+25/+40% enemy power: marsh 28/7/2 natural vs 98/70/58 at +60; cliffs 65/43/25 vs
85/57/53; patrol 90/40/25 vs 95/58/20; foundry, skirmish (knight + archer) and wolves barely
move. Enemy tactics matter too: smart marsh sandstalkers now flank. Tuning panel: **Tactics**
group (`tactics` scale, `playerTactics`, `enemyTactics`).

Two fixes found on the way: lurking flankers first got a big caution boost, which made them flee
from enemies who came to them (wolves 48% -> 10% with smarter units); now they only refuse to step
*into* reach. And AI damage values are now fractional: chip damage (an estoc on plate, ~1% of HP)
had rounded to zero, so the duelist stopped attacking at all.

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
   Samples are also spread over the chosen formation spot and its 8 neighbours, so the result
   reflects "roughly here with this roster": a one-tile shift can't flip it.
3. One of the samples with that result is replayed (preferably one formed up exactly where you
   chose), chosen by margin: comfortable on easy
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

## 3D battle view

`src/web/render3d.ts` (three.js) renders playback as a small diorama: tiles with height (stone walls,
sunken water, thicket bushes), an orbit/pitch/zoom camera, and low-poly units built from primitives
per class and race (knights with shield and helmet, archers with bows, mages in pointy hats, wolves
on four legs, golems, steam automatons, mud blobs). Animations: idle bob and sway, hops between
tiles, turning to face, melee lunges, projectiles for ranged attacks and spells, ring pulses for area
abilities, hit flashes and dodge wobbles, heal sparkles, knockouts that topple and sink. Text
(damage numbers, speech bubbles, status tags) is an HTML overlay so it stays crisp.

It is pure presentation: it reads the same playback state as the 2D canvas plus log events as
animation cues, so it shows whichever battle the settle step picked. three.js makes the bundle
~630 kB (lazy-loading it is an easy later win).

## Run loop

`src/run/run.ts` (pure TS, deterministic from the run seed; the browser and the auto-player share it).

- Roster: start with 5 (Aldric, Wren, Oswin, Kesh, Sela), up to 8. Recruits come from rewards
  (including Aeris, a flyer).
- Encounters: the five scenarios in a shuffled order per cycle; the roster replaces the scenario's
  preset units and forms up at the chosen spot. Enemy strength +5% per battle (`ramp`).
- Progression: 100 XP per battle (50 if knocked out); the next level costs 100 + 50 per level gained,
  so growth is front-loaded and the ramp catches up. A level gives +2 HP and +1 to the class's main
  stat every other level. Training gives +2 to a stat (+4 HP); trinkets go up to 2 per unit.
- Hearts: 5 (max 5). A loss costs 1 / 2 / 3 hearts when the enemy finished with under 35% /
  under 70% / more of its HP. 3 reward offers after a win, 2 after a loss.

`npm run autorun -- --runs 24 --ramp 5 --policy sensible|careless` plays whole runs headlessly
(sensible: deploys its highest levels, rests when low, recruits to 6, then trains; careless: random
deployment and rewards). Measured on normal with the pacing rules and scenarios tuned to the run
roster, 16 runs each:

| ramp | sensible: battles per run [10th-90th], battles won | careless |
|---|---|---|
| 3% | 60 [41-60], 98% (runs cap at 60) | 21 [10-28], 82% |
| 4% | 36 [24-48], 87% | 15 [10-24], 77% |
| 5% (default) | 19 [11-28], 78% | 11 [8-16], 73% |
| 5%, + commitment (16 runs) | 21 [7-30], 81% | 9 [6-16], 72-79% |
| 5%, + tactics and roles (16 runs) | 14-18 [7-23], 79-82% | 11-12 [8-17], 69-73% |

(Before the pacing change, at 5%: 16 [12-22] 78% and 10 [6-13] 65%.)

Before smoothing, sensible runs died at a median of 9 battles at every ramp: the 2v2 skirmish
settled as a loss from most formation spots (0% one row up, 92% on its default row) and cost 3
hearts each time.

## Known issues and next steps

- **Elevation everywhere, flyers in one fight:** every map has heights now (hills, ridges, gantries,
  hummocks, a knoll; furnace pits in the foundry). Flyers: Aeris, a winged-folk skyguard (in
  Cliffside, and recruitable in runs), and two enemy harpies in Cliffside.
- **2v2 fights are placement-fragile underneath.** Smoothed settling hides it, but the raw skirmish
  still swings hard between adjacent rows (who meets whom first). The skirmish needs a big enemy
  nerf (-67% power).
- **The 3-unit mirror (knight, archer, cleric) is placement-chaotic.** In `robustness --settle` it
  settles as a player win from only 20% of placements on normal (p range 0-88%), with or without
  tactics (checked with `--rules '{"tactics":0}'`); raw from its default spots the player wins 65%.
  Who meets whom first decides it; it has drifted with every AI change. Worth a dedicated look.
- **Foundry and Cliffside are hard on the starting roster** (Kesh, reckless, dives in and dies
  first; Cliffside's crossbows on a 2 m bluff punish Sela without a flyer to answer them), so they
  carry big power cuts (0 and +25, from +12 and +70) and their curves are bumpy.
- **Run loop balance is first-pass.** The auto-player numbers come from 24 runs per cell. Skirmish
  (2 slots) is the most common run-ender. Retrying a lost battle (design notes) isn't built yet.
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
