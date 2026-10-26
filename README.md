# Dungeon Co-Pilot

An execution assistant for Hypixel SkyBlock **Catacombs** (F1–F7, M1–M7). You play; the co-pilot keeps the
dungeon map, routes, score projection and class duties current as you enter what happens. It then tells
each player what to do next.

```
npm start            # dashboard at http://127.0.0.1:4545
npm test             # unit, API and scenario tests (node:test, no dependencies)
npm run scenarios    # run the documented scenarios; add -- --verbose for routes
node src/cli.js plan healer F6   # print a class execution plan
```

Requires Node 20+. There are no npm dependencies.

## Rules and scope

Hypixel's [Allowed Modifications](https://support.hypixel.net/hc/en-us/articles/6472550754962/) policy
treats anything that is not clearly client-side and non-advantageous as disallowed. It does not publish a
dungeon-specific list. So this tool is deliberately a **separate companion app**:

- It has no Minecraft client mod, no packet or memory reading, no screen capture and no input injection.
- Every piece of state comes from the player clicking in the dashboard: rooms, secrets, clears, deaths and
  terminals.
- Movement, combat, interactions, puzzles and terminals are always done by the player. Puzzle tips are
  general how-to text, not solvers.

No live game integration is implemented. Adding one (a mod or log reader) would need a fresh check of the
current Hypixel rules first. The Hypixel public API exposes profile data only, not live run state, so it is
not used.

## What it does

| Area | Implementation |
| --- | --- |
| Session manager | `src/session.js`: event-sourced runs persisted as JSON in `data/sessions/`, with atomic batches, undo/redo, revert of any past entry, and resume after restart |
| Map model | `src/engine/map.js`: grid cells, multi-cell rooms (1x1…2x2, L), doors (assumed / normal / wither / blood / wall), frontier and completeness |
| Route engine | `src/engine/route.js`: all-pairs shortest paths; objectives for rooms, puzzles, frontier exploration and secret revisits; cost-based secret and crypt selection; makespan-aware assignment, 2-opt and relocation; blood rush with wither-key fetch |
| Score model | `src/engine/score.js`: Skill / Explore / Speed / Bonus per the wiki "Dungeon Score" formulas, floor secret requirements, time limits and allowances |
| Decision logic | `src/engine/advisor.js`: the current action per player by phase (setup, clearing, blood camp, boss, complete), class-specific hints, revive priority, F7 terminal slots |
| Class plans | `src/data/classes.js` + `src/engine/plans.js`: plans for Berserk, Archer, Mage, Tank and Healer across 8 sections, adjusted for floor, party composition, strategy and live roles |
| Diagnostics | Inefficient adopted plan (offers the optimized one), behind schedule, score short of target, secrets short, imbalance, dead players, unknown blood, incomplete map, missing keys, unreachable rooms, failed puzzles |
| Dashboard | `public/`: SVG map editor, NOW card with confirm buttons, plan health and confidence, score and timeline, party, execution plan, boss and terminals, objectives, strategy, event log |

### Stable but adaptive routes
When the run starts, the current assignment is locked in (`plan_adopt`). Newly discovered rooms are added to
the nearest routes without reshuffling anyone. The engine also computes a fresh plan every time. If that plan
beats the locked one by more than max(15s, 8%), a **rebalance** warning offers a one-click switch.

### Confidence
Unrecorded doors are "assumed" open. Secret totals fall back to estimates by shape, and unknown cells are
estimated as rooms. The dashboard shows map, door, secret and time confidence, and marks every estimated
step or plan item.

## Scenarios

`scenarios/*.json` are documented runs replayed through the real session manager, with expectations checked
at each step:

1. F5 full map: rusher and puzzle-solver selection, key fetch before the rush, S+ projection.
2. F3 incomplete map: exploration and "blood not located", then unexpected discoveries recalculated live.
3. F6 missed secrets: revisits of cleared rooms, and the score shortfall when secrets are turned off.
4. F4 party changes: a player leaves, a class swaps, a replacement joins; no rooms are orphaned.
5. F7 inefficient plan: a lopsided split is detected and the optimized plan offered; a discovery keeps it stable.
6. M3 failed puzzle and death: wait/revive actions, score shortfall, class recovery advice.
7. F7 boss: per-class phase duties and Goldor device/terminal/lever slots that advance as they are completed.
8. F1 solo run.
9. F2 wrong wall: unreachable rooms, the correction, and a keyless wither-door entry being rejected.
10. F1 behind schedule: speed warning, and a better projection after switching the secret strategy.

## Known limits

- Grid sizes, puzzle counts, clear times, blood-camp and boss durations are planning estimates
  (`src/data/floors.js`, `src/data/rooms.js`).
- F7 device owners and M7 dragon teams follow common conventions, which vary between parties. Override
  them per slot in the Boss tab.
- The projected skill score scales with rooms cleared, so it is meaningful mid-run. The wiki gives the
  completed-run form, 100 − penalties, which the projection matches on a full clear.
