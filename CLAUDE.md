# CLAUDE.md

Tactical RPG autobattler prototype. Full design: "Tactics Autobattler: Design Notes"
(https://claude.ai/artifact/G9fSJf5VyuY8fcwm2ibHku). Read it before larger design work.
README.md describes the architecture and current mechanics.

This is a hobby prototype, not production software. Prefer simple, working code over
anticipating every future need. It is fine to leave TODOs.

## Commands

- `npm test` and `npm run typecheck`: run both before committing.
- `npm run battle -- <scenario> <seed> [--debug]`: print one battle's text log (+ AI scores).
- `npm run batch -- <scenario|all> <runs>`: headless balance stats over seeds 1..runs.
- `npm run dev`: Vite dev server for the browser front end.

## Architecture rules (from the design notes)

- `src/sim` is pure TypeScript with no DOM or Node APIs; `tsconfig.sim.json` enforces this
  (lib ES2022 only, no @types). It must run in the browser, a web worker and Node.
- Deterministic: same content + scenario + seed + options => identical battle log. Use the seeded
  `Rng` (only for combat rolls), integer maths for game results (`idiv`), and fixed iteration and
  tie-break orders. No `Math.random`, no `Date`. AI scores may use plain float arithmetic.
- Battles are baked: the whole fight is simulated up front; the log (`src/sim/log.ts`) is the
  sim's only output. Rendering, speech bubbles and stats read the log, never sim internals.
- Simulation throughput matters (map generation will simulate thousands of battles).
  Check `npm run batch` battles/s after touching hot paths (`ai.ts`, `grid.ts`, `stats.ts`).
- Content is data in `src/content`. New abilities should be built from existing effect pieces,
  shapes and triggers; add a new piece only when no combination works. Keep `validateContent`
  in step with new reference fields.
- Players never write rules; personality = utility-AI weights (see `traits.ts`).
- After AI or content changes, rerun `npm run batch -- all 100` and watch for draws (stalemates)
  and win-rate swings; tune scenario `enemyMods` if needed.
