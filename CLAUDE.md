# CLAUDE.md

Tactical RPG autobattler prototype. Full design: "Tactics Autobattler: Design Notes"
(https://claude.ai/artifact/G9fSJf5VyuY8fcwm2ibHku). Read it before larger design work.

This is a hobby prototype, not production software. Prefer simple, working code over
anticipating every future need. It is fine to leave TODOs.

## Commands

- `npm test` / `npm run typecheck` — run both before committing.
- `npm run battle -- <scenario> <seed>` — print one battle's text log.
- `npm run batch -- <scenario> <runs>` — headless balance stats over seeds 1..runs.
- `npm run dev` — Vite dev server for browser playback.

## Architecture rules (from the design notes)

- `src/sim` is pure TypeScript with no DOM or Node APIs; `tsconfig.sim.json` enforces this
  (lib ES2022 only, no @types). It must run in the browser, a web worker and Node.
- Deterministic: same content + scenario + seed => identical battle log. Use the seeded `Rng`,
  integer maths (`idiv`, no floats in sim results), and deterministic iteration/tie-breaks.
  No `Math.random`, no `Date`, no reliance on object key order for game logic.
- Battles are baked: the whole fight is simulated up front; the log (`src/sim/log.ts`) is the
  sim's only output. Rendering, speech bubbles and stats read the log, never sim internals.
- Simulation throughput matters (the map generator will simulate thousands of battles).
  Check `npm run batch` battles/s after changes to hot paths.
- Content is data in `src/content`. Abilities should end up as data built from a small set of
  effect pieces + triggers, not bespoke code per ability.
- Players never write rules; personality = utility-AI weights.

## Current state

Build step 1 done (two-unit text-log battle). Next per the design notes: modifier stack,
then utility AI (replace the placeholder in `src/sim/ai.ts`), then effects/triggers.
