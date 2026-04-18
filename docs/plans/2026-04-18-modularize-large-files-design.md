# Modularize Large Files — Design

**Date**: 2026-04-18
**Status**: Approved, ready for plan
**Scope**: Split the 4 source files that exceed 300 lines (the project's modularity rule) into smaller sibling files. Add a smoke test harness to catch regressions during the refactor. Update CLAUDE.md with conventions that emerged from this work.

## Goals

- Bring `shapeOperations.js` (761), `blueprintLayout.js` (856), `blueprintRenderer.js` (687), and most of `shapeSolver.js` (1153) under the 300-line modularity rule.
- Establish a smoke test harness that catches solver/layout regressions cold (one-time investment, reusable forever).
- Modernize the codebase to be agent-friendly (small focused files that any model can hold in context at once).
- Do not change `main.js` imports — public entry-point file names stay the same.
- Do not break behavior. The smoke test plus manual browser verification proves it.

## Non-Goals

- Splitting the other three files over 300 lines (`operationGraph.js` 461, `main.js` 435, `shapeRendering.js` 443). Out of scope for this pass; can be a follow-up.
- Adding first-line description comments. Public repo + descriptive filenames make them unnecessary; rule is being added to CLAUDE.md.
- Adding a test framework. Plain Node script is enough.
- Adding a build step. The project remains a no-build vanilla-ES-modules-in-browser project.
- Refactoring `shapeSolver`'s search algorithm or `assignPositions`'s sequential pipeline. Both are documented orchestrator exceptions.

## Constraints

- **No build system.** All files are loaded as ES modules directly by the browser. Imports must be relative paths with `.js` extensions.
- **No tests exist today.** Manual browser verification has been the only safety net. We add one (smoke harness) as part of this work.
- **Public repo.** No internal references, no first-line context comments, no Helm-internal terms in code or docs that ship.
- **`main.js` import surface stays unchanged.** All current imports in `main.js` (`Shape`, `_extractLayers`, `_filterStartingShapes` from `shapeOperations.js`; `buildLayout`, `duplicateForThroughput` from `blueprintLayout.js`; `BlueprintRenderer` from `blueprintRenderer.js`; etc.) must continue to work. The 4 originals become orchestrators that re-export from siblings.

## Architecture

The four source files split into ~13 sibling files. The original filenames stay as the public entry points (orchestrators) and re-export the public surface from sibling files. Sibling files share the orchestrator's prefix (`shapeSolver*.js`, `blueprint*.js`, etc.) so the relationship is visible from filenames alone.

### shapeOperations.js (761 lines) → 4 files

| New file | Contents | Est. lines |
|---|---|---|
| `shapeOperations.js` (orchestrator) | The 12 op exports (`cut`, `halfCut`, `rotate90CW`, `rotate90CCW`, `rotate180`, `swapHalves`, `stack`, `topPaint`, `pushPin`, `genCrystal`, `trash`, `beltSplit`) + `_getAllRotations` + re-exports of `Shape`/`ShapePart`/`ShapeOperationConfig`/`InvalidOperationInputs` | ~250 |
| `shapeClass.js` | Constants (`NOTHING_CHAR`, `SHAPE_LAYER_SEPARATOR`, `PIN_CHAR`, `CRYSTAL_CHAR`, `UNPAINTABLE_SHAPES`, `REPLACED_BY_CRYSTAL`), `ShapePart`, `Shape`, `ShapeOperationConfig`, `InvalidOperationInputs` | ~150 |
| `shapeOperationsHelpers.js` | Private layer-manipulation helpers: `_gravityConnected`, `_crystalsFused`, `_getCorrectedIndex`, `_getConnectedSingleLayer`, `_getConnectedMultiLayer`, `_breakCrystals`, `_makeLayersFall`, `_cleanUpEmptyUpperLayers`, `_differentNumPartsUnsupported` | ~250 |
| `shapeAnalysis.js` | Shape analysis exports used by the solver: `_extractLayers`, `_getPaintColors`, `_getCrystalColors`, `_getSimilarity`, `_getPartTypeCounts`, `_getPartCounts`, `_compareCounts`, `_comparePartOrder`, `_getRequiredColors`, `_getRequiredShapes`, `_filterStartingShapes` | ~250 |

### shapeSolver.js (1153 lines, Web Worker) → 6 files

`shapeSolver.js` is a **Web Worker entry point**, not a regular module — `main.js` instantiates it via `new Worker(new URL('./shapeSolver.js', import.meta.url), { type: 'module' })`. The current file uses `self.onmessage` / `self.postMessage` and does not export anything. The split separates the algorithm (testable, regular ES module) from the Worker plumbing (small wrapper).

| New file | Contents | Est. lines |
|---|---|---|
| `shapeSolver.js` (Worker entry — NOT an orchestrator) | `self.onmessage` handler, local `cancelled` flag, dispatches to `shapeSolverCore`, posts `result`/`status` messages back. `main.js`'s `new Worker('./shapeSolver.js', ...)` continues to work unchanged | ~30 |
| `shapeSolverCore.js` (orchestrator) | Exported `shapeSolver` function (BFS/A*/IDA* search loop with closures over shared state — kept whole, orchestrator exception). Exported `shapeExplorer`. `operations` table. **API change**: takes `shouldCancel: () => boolean` and `onProgress: (msg: string) => void` callbacks instead of reading `cancelled` directly and calling `self.postMessage` from inside the loops | ~700 |
| `shapeSolverPriorityQueue.js` | `PriorityQueue` class | ~60 |
| `shapeSolverCache.js` | `shapeCache` + `getCachedShape`, `getCachedOpResult1`, `getCachedOpResult1Color`, `getCachedOpResult2` and the underlying op-result caches | ~110 |
| `shapeSolverInverse.js` | `inverseUnpaint`, `inverseRotateCW`, `inverseRotateCCW`, `inverseRotate180`, `inverseUnstack`, `inverseUncut`, `inverseUnpin` | ~135 |
| `shapeSolverBackward.js` | `buildBackwardReachability` (the orchestrator that wires inverse ops together) | ~50 |

**Why `shapeSolver` (in `shapeSolverCore.js`) stays one big function:** It contains 6+ inner closures (`getCachedSimilarity`, `getHeuristic`, `calculateStateScore`, `getCanonicalCode`, `getStateKey`, `isGoal`) that capture local state — `target`, `config`, `shapes`, `similarityCache`, `canonicalCache`, `acceptable`, `nextId`. Plus the BFS/A*/IDA* loops below them. Extracting the closures requires either passing 5–10 args per call or restructuring around a `SolverContext` object. Both are worse than the current shape. Documented as orchestrator exception in CLAUDE.md.

**Why the Worker wrapper is separate:**
- The algorithm becomes a regular ES module that can be `import`ed from Node — enables the smoke test harness.
- Worker plumbing (message dispatch, cancellation flag, progress posting) is small, single-purpose, and not algorithm logic.
- This is genuine separation of concerns — agent-friendly structure.

**Callback threading details:** `shouldCancel` and `onProgress` replace direct `cancelled` reads and `self.postMessage` calls inside the search loops. The Worker wrapper passes `() => cancelled` and `(msg) => self.postMessage({ type: 'status', message: msg })`. The smoke test passes `() => false` and a no-op. This is a real internal change to the algorithm's call sites (every `if (cancelled)` and every `self.postMessage({ type: 'status', ... })` becomes a callback call), but mechanical.

### blueprintLayout.js (856 lines) → 4 files

| New file | Contents | Est. lines |
|---|---|---|
| `blueprintLayout.js` (orchestrator) | `buildLayout` (calls topology → rows → positions → routing), `duplicateForThroughput` | ~150 |
| `blueprintTopology.js` | `extractTopology`, `topoSort`, `groupIntoRows` | ~250 |
| `blueprintPositions.js` | `assignPositions` — orchestrator-shaped sequential pipeline, kept whole | ~300 |
| `blueprintRouting.js` | `routeBelt` | ~70 |

**Why `assignPositions` stays one big function:** It is a sequential pipeline (compute row widths → place sources → place machines row-by-row → resolve overflow → ...) where each phase reads/writes shared local state (`machinePos`, `outputPorts`, `sourceEntries`, `rowWidths`, `maxRowWidth`). Splitting it into phase functions would require either threading 6+ mutable refs through every call or hoisting all state to a class. Easier to read top-to-bottom in one file. Documented as orchestrator exception.

### blueprintRenderer.js (687 lines) → 3 files

| New file | Contents | Est. lines |
|---|---|---|
| `blueprintRenderer.js` (orchestrator) | `BlueprintRenderer` class — keeps state, lifecycle, event handling: `constructor`, `setLayout`, `setFloor`, `exportPng`, `destroy`, `_handleResize`, `_filterFloor`, `_centerView`, `_render`. The class delegates to standalone draw functions | ~300 |
| `blueprintDrawing.js` | Standalone draw functions taking `(ctx, state)`: `drawScene`, `drawGrid`, `drawBelts`, `drawMachines`, etc. (every `_drawXxx` method extracted from the class) | ~350 |
| `blueprintColors.js` | `machineColor`, `darken` | ~25 |

The current draw methods read instance state directly (`this._layout`, `this._visibleBelts`, `this._floor`, etc.). Extraction requires explicitly threading those values through as parameters: each method becomes a function taking `(ctx, layout, visibleBelts, floor, ...)` — concretely, every `this._foo` reference in a draw method becomes a `state.foo` parameter access. This is mechanical but it does change every signature; the class keeps lifecycle/state and calls these functions with `this._foo` arguments.

### Result summary

| Metric | Before | After |
|---|---|---|
| Files >300 lines | 4 (all targeted) | 2 (`shapeSolverCore.js` ~700, `blueprintPositions.js` ~300) — both documented orchestrator exceptions |
| Total source files | 11 | ~25 |
| `main.js` imports | unchanged | unchanged |
| `main.js` Worker URL (`new Worker('./shapeSolver.js', ...)`) | unchanged | unchanged |

## Smoke Test Harness

**Location**: `tests/smoke.js` (new directory). No test framework — single Node script, run with `node tests/smoke.js`.

**Approach**: Snapshot a fixed set of solver/layout outputs once, diff future runs against the snapshot. Re-run after each split commit to catch regressions immediately.

**Test cases** (~6–8 fixtures):

| Case | Input | What it covers |
|---|---|---|
| Simple cut | trivial shape, BFS | basic path |
| Rotate | rotation ops | A* with rotate-only ops |
| Stack | 2-layer from 1-layer parts | `stack` op |
| Paint | colored shape from uncolored base | paint ops |
| Pin/crystal | shape with pins from base | `pushPin` + `genCrystal` |
| A* heuristic | medium complexity | exercises heuristic + similarity cache |
| IDA* | deep search depth-limited | exercises IDA* path |
| Layout | fixed `solutionPath` | exercises `buildLayout` end-to-end |

**What's checked per case:**
- `shapeSolver()` cases: `numOps`, `pathLength`, final shape code matches target.
- Layout case: machine count, gridWidth, gridHeight, floor count.
- Plus a few pure-function spot checks: `cut()`, `stack()`, `rotate90CW()`, `_getSimilarity()` on known inputs.

**Snapshot format**: `tests/snapshots.json`. First run records expected outputs. Subsequent runs diff. Any intentional output change requires manual snapshot update (delete + re-run).

**Output format**:
```
✓ Simple cut (3 ops, A*)
✓ Rotate (4 ops, A*)
✗ Stack — expected numOps=2, got 3
```

Non-zero exit code on any diff so the harness can be wired into CI later if desired.

**Module loading note**: Source files are browser-style ES modules. To run them in Node, add `"type": "module"` to a `package.json` (or to `tests/package.json` if the project doesn't have one).

**Solver test target**: The smoke test imports `shapeSolver` and `shapeExplorer` from the new **`shapeSolverCore.js`**, NOT from `shapeSolver.js`. The latter is the Worker entry point and uses `self.onmessage`/`self.postMessage` — unimportable from Node without stubs. The core module exports the algorithm as a regular function taking `shouldCancel` / `onProgress` callbacks, which the smoke test passes as `() => false` and a no-op respectively.

**DOM-touching modules**: `blueprintLayout` and `shapeOperations` are pure logic (no DOM, no canvas) and import directly. `blueprintRenderer`, `shapeRendering`, `operationGraph`, and `main` all touch the DOM/canvas/Cytoscape and are NOT used by the smoke test.

## CLAUDE.md Updates

Three edits to `shapez2-solver/CLAUDE.md`:

**1. Project Structure** — replace the verbose flat list with one prose sentence:

> Each of the four major modules — `shapeOperations`, `shapeSolver`, `blueprintLayout`, `blueprintRenderer` — is a public-entry-point file with a small set of sibling helper files prefixed by the same name (e.g., `shapeSolverCache.js`, `blueprintTopology.js`).

**2. Known Issues / Tech Debt** — remove the resolved item: *"Several files exceed 300 lines (shapeOperations.js, blueprintLayout.js, shapeSolver.js, blueprintRenderer.js) — candidates for splitting"*. Leave the others.

**3. Add new "Conventions" section:**

> ## Conventions
>
> - **No first-line description comments on source files.** This is a public repo; filenames are descriptive enough. The auto-generated context tree convention used in private projects does not apply here.
> - **Orchestrator exception to the 300-line rule.** Two files intentionally exceed 300 lines because their job is coordinating tightly-coupled steps that don't extract cleanly:
>   - `shapeSolverCore.js` (~700 lines) — the search algorithm has many inner closures over shared state (caches, target, config, shape map). Extracting them would require passing 5–10 args per call or restructuring around a `SolverContext` object — both worse than the current shape.
>   - `blueprintPositions.js` (~300 lines) — `assignPositions` is a sequential pipeline (compute widths → place sources → place machines → resolve overflow → ...) where each phase reads/writes shared local state. Best read top-to-bottom in one place.

## Implementation Order

Each step is an atomic commit so the smoke test can bisect failures.

1. **Add smoke test harness** (before any splitting). Captures baseline snapshot. Run once to confirm green.
2. **Split `shapeOperations.js`** — pure functions, lowest risk. Extract `shapeClass.js`, then `shapeOperationsHelpers.js`, then `shapeAnalysis.js`. Run smoke after each commit.
3. **Split `blueprintLayout.js`** — extract `blueprintTopology.js`, `blueprintPositions.js`, `blueprintRouting.js`. Run smoke after each.
4. **Split `shapeSolver.js`** — riskiest because of closure-heavy main function AND the Worker→core split. Order:
   1. Extract algorithm to `shapeSolverCore.js`: thread `shouldCancel`/`onProgress` callbacks through every `cancelled` read and `self.postMessage({type:'status'})` call. Worker file becomes a thin wrapper that imports core and dispatches messages. **This is the highest-risk single step** — verify smoke + manual browser before continuing.
   2. Extract `shapeSolverPriorityQueue.js` from core.
   3. Extract `shapeSolverCache.js` from core.
   4. Extract `shapeSolverInverse.js` from core.
   5. Extract `shapeSolverBackward.js` from core.
   Run smoke after each commit.
5. **Split `blueprintRenderer.js`** — extract `blueprintColors.js`, then `blueprintDrawing.js`. Class stays as state/lifecycle orchestrator. Smoke covers solver/layout but not renderer; manual browser verification at the end.
6. **Update CLAUDE.md** — Project Structure prose sentence, remove resolved tech-debt item, add Conventions section.
7. **Manual browser verification** — load the site locally, run a representative solve, switch between Flowchart/Blueprint tabs, verify visual output matches pre-refactor.
8. **Commit + deploy.**

## Verification Plan

- **Smoke test passes** — covers solver (BFS/A*/IDA*) and blueprint layout end-to-end. Run after every commit during the refactor.
- **Manual browser pass** — load `https://mase.fi/shapez` locally, perform:
  - Simple solve (`CuCuCuCu` from defaults) — confirm graph renders
  - Multi-color solve — confirm color modes still work
  - Switch to Blueprint tab — confirm canvas renders machines + belts
  - Pan/zoom on blueprint — confirm interactivity
  - Floor switch (if any multi-floor layout) — confirm `_filterFloor` still works
  - Export PNG from blueprint — confirm `exportPng` still works
- **No console errors** — open DevTools, confirm no import errors, no thrown exceptions during normal use.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Closure extraction subtly changes solver behavior | We're explicitly NOT extracting closures from `shapeSolver`. The function stays whole. |
| Renderer regression not caught by smoke (canvas) | Manual browser verification step is mandatory before deploy. |
| `assignPositions` partial extraction breaks layout | We're explicitly NOT decomposing it. Stays whole as orchestrator exception. |
| ES module loading breaks in Node | Add `"type": "module"` to `package.json` (or `tests/package.json`). Smoke test imports only DOM-free modules: `shapeSolverCore`, `shapeOperations`, `blueprintLayout` — never `shapeSolver.js` (Worker), `blueprintRenderer`, or `main`. |
| Worker→core extraction subtly breaks cancellation or progress posting | First commit of step 4 is just the Worker→core split with callback threading. Verify in browser (run a long solve, hit cancel) before any further extraction. |
| Browser-side import path errors after split | Each split commit is atomic and runs the smoke test. Browser-relative paths use `.js` extensions consistent with current style. |
| Snapshot needs intentional update mid-refactor | If a split intentionally changes output (it shouldn't), manually update snapshot and note in commit message. |

## Out of Scope (Captured for Later)

- Splitting the other 3 files over 300 lines (`operationGraph.js`, `main.js`, `shapeRendering.js`).
- Adding a test framework or running tests in CI.
- Restructuring the `shapeSolver` algorithm into a `SolverContext` class.
- Decomposing `assignPositions` into phase functions.
- Adding obstacle-avoiding belt routing (long-standing tech debt).
- Multi-floor blueprint layout (long-standing tech debt).
