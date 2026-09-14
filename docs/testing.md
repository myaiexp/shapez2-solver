# Testing

Tests are plain `node tests/**/*.js` scripts (no framework), grouped by subsystem into `tests/{shape,solver,blueprint,shared}/` — mirroring the source's prefix-grouping.

`shared/` holds the harness (`fixtures.js`, `layoutFixtures.js`, `smoke.js`, `solve.mjs`, `snapshots.json`, `similarity.js`, `pathValidation.js`, `smokeSnapshot.js`, `layoutCollisions.js`) plus cross-cutting app tests (`colorMode`, `persistence`, `persistenceApply`, `exploreDepth`, `pathInventory`, `operationGraph2D`, `clipboardFeedback`). `layoutFixtures.js` is the hand-written `buildLayout` paths; `fixtures.js` re-exports them. Explorer fixtures may carry a `target` (7th arg to `shapeExplorer`) so Painter / Crystal Generator color enumeration is target-narrowed; omit it for the inventory-union path. An optional `expectShapes` list is asserted present in the explored graph — use it when the count snapshot can't tell which color an op chose.

The Worker wrapper (`shapeSolver.js`) is covered by `tests/solver/workerDispatch.test.js`, which stubs `globalThis.self` and drives `self.onmessage` — Constructive dispatch, `nodeBudget` vs the core caps, explore-depth clamp, the explore node cap, cancel suppression, and `{type:'error'}` on a malformed target.

Presentation code runs against stubs, not a browser. The flowchart's structure is built by the pure `buildGraphElements` (`operationGraphElements.js`); `tests/shared/operationGraph2D.test.js` covers it directly, then drives `renderGraph`/`reRenderGraph` with `document` + `cytoscape` stubs to pin that a cleared solve is never redrawn. `tests/blueprint/blueprintRenderer.test.js` stubs `window`, `ResizeObserver`, `document.createElement` and a recording 2D context to cover `BlueprintRenderer` floors, zoom/pan, hover, `exportPng` and `destroy`. Neither can catch a real Cytoscape or canvas rendering regression.

The full suite is zero-dependency and runs in well under a second. Each file `process.exit(1)`s on failure, so exit codes drive both gates below. Before committing solver/layout/shape-operations changes, run `node tests/shared/smoke.js` (snapshot suite + per-step solution-path validation) and the relevant `tests/**/*.test.js` unit suites.

Shape ops must never mutate their input `Shape` objects — the solver shares parsed shapes via `getCachedShape`, so in-place mutation corrupts the cache and yields impossible paths; `tests/shape/shapeCacheIntegrity.test.js` guards this.

`similarity.js` is the solver's retired pre-#1677 heuristic — test-only, kept because smoke snapshots it as a pure op; never import it from app code.

## Path-validation gate

`tests/shared/pathValidation.js` is the single correctness gate behind every harness and suite that validates a path. A path must clear three independent checks:

1. every step replays as a real op
2. the ids flow physically (each consumed once; fan-out needs a `Belt Split`)
3. the final inventory holds the target (a zero-op path passes iff a starting shape is acceptable)

It has its own unit suite, `pathValidation.test.js`, because a hole in the gate silently unblocks every importer at once. Production inventory predicates (`pathReachesTarget`, `pathInventoryAcceptable`, `acceptableCodes`) live in `pathInventory.js` and are re-exported from `pathValidation.js` so harness imports stay one-stop.

## Two gates, same suite

CI (the `test` job in `.github/workflows/pages.yml`) runs the suite on every push to `master`, and the Pages **deploy is gated on it** (`deploy: needs: test`) — a red test blocks shipping to mase.fi/shapez.

Both gates discover `tests/**/*.test.js` into an array (quoted iteration, so paths with spaces stay one file), refuse to proceed if fewer than 30 files matched (an empty `find` used to make the loop succeed vacuously), then run `node tests/shared/smoke.js` and two cheap `solve.mjs` invocations. Keep the floor and the `solve.mjs` lines in lockstep between the workflow and `.githooks/pre-commit`.

Locally, `.githooks/pre-commit` runs it before each commit; activate once per clone with `git config core.hooksPath .githooks` (bypass a single commit with `git commit --no-verify`).

## Headless solve/explore harness

`node tests/shared/solve.mjs` runs a solve (or `--explore N`) from the CLI and validates every step is a real operation. Use it to reproduce and diagnose solver/operation bugs without the browser. CI and pre-commit each run one solve (`CuCu----` / Cutter) and one `--explore 2` so a signature change in the modules it wraps fails the gate.

Flag set, methods, and defaults live in the usage header at the top of `tests/shared/solve.mjs` — read that rather than copying a subset here.

## Snapshot baselines

`tests/shared/smoke.js` diffs op/layout/solver/explorer outputs against `tests/shared/snapshots.json`. A missing `snapshots.json`, or a fixture key with no baseline, is a failure — it does not record current behavior and pass.

Record or refresh baselines explicitly:

```
SMOKE_UPDATE=1 node tests/shared/smoke.js
```

That writes missing keys (`[baseline written]`) and overwrites mismatches (`[baseline updated]`). Review the `snapshots.json` diff before committing; a new fixture's first baseline is whatever the implementation produces today.

Layout snapshots include `overlappingBeltTiles` (distinct `(x,y,floor)` positions with more than one belt — currently non-zero because routing is L-shaped with no obstacle avoidance) and `beltsOverMachineFootprint` (belt tiles on a machine footprint). `beltsOverMachineFootprint` is also a hard gate: smoke fails any layout fixture where it is non-zero, before the snapshot compare, so `SMOKE_UPDATE=1` cannot record a regression as the new baseline.

Smoke also runs every solver-produced path through `persistence.js`'s `isValidSolutionPath` (the restore gate), so a path the solver emits but a page reload would discard fails the suite. Storage load/save/clear lives in `persistence.test.js`. The DOM side — `captureState`/`applyState`, main.js's restore path — lives in `persistenceApply.test.js`, which runs them against a fake `document` mirroring `index.html` (unknown selectors throw; every looked-up id is checked against the real page) and fake renderer deps.
