# Modularize Large Files Implementation Plan

**Goal:** Split the 4 source files exceeding 300 lines into smaller sibling modules, separating the Web Worker entry from the algorithm core, while preserving behavior verified by a new smoke test harness.

**Architecture:** Original filenames stay as the public surface (orchestrators or, in `shapeSolver.js`'s case, a thin Worker wrapper). New sibling files share the original's prefix. The `shapeSolver` algorithm moves to a new `shapeSolverCore.js` and takes `shouldCancel` / `onProgress` callbacks so it's testable from Node. A `tests/smoke.js` harness snapshots solver+layout outputs for regression detection at every commit.

**Tech Stack:** Vanilla ES modules, no build, no test framework. Node 20+ for the smoke harness (uses native ES modules). Existing imports in `main.js` unchanged.

---

## Task 1: Smoke Test Harness

**Files:**
- Create: `package.json` (just `{"type": "module"}` so Node treats `.js` as ES modules)
- Create: `tests/smoke.js` (runner)
- Create: `tests/fixtures.js` (test cases data)
- Create: `tests/snapshots.json` (generated on first run; commit baseline)

**Contracts:**

`tests/fixtures.js` exports:
```js
export const SOLVER_FIXTURES = [
  { name: 'simple-cut', target: '...', starting: [...], ops: [...], maxLayers: 1, method: 'BFS', maxStatesPerLevel: Infinity, preventWaste: false, orientationSensitive: false, monolayerPainting: false },
  // ... 6-7 more cases covering BFS, A*, IDA*, rotate, stack, paint, pin/crystal
];

export const LAYOUT_FIXTURES = [
  { name: 'simple-layout', solutionPath: [...] },
  // 1-2 cases
];

export const PURE_OP_CHECKS = [
  { name: 'cut-CuCuCuCu', fn: 'cut', input: ['CuCuCuCu'], expected: { /* shape codes */ } },
  // 3-4 spot checks for cut, stack, rotate90CW, _getSimilarity
];
```

`tests/smoke.js` exports nothing; running it (`node tests/smoke.js`) prints results and exits with code 0 on full pass, 1 on any diff/error.

**Behavior:**
- For each `SOLVER_FIXTURES` case: import `shapeSolver` from `shapeSolverCore.js` (after Task 4a) — for Tasks 1–3 import from a shim `tests/solverShim.js` that wraps the current Worker file (see Constraints). Call with `shouldCancel: () => false`, `onProgress: () => {}`. Record `{ numOps, pathLength, finalShapeCode }`.
- For each `LAYOUT_FIXTURES` case: import `buildLayout` from `blueprintLayout.js`. Record `{ machineCount, beltCount, gridWidth, gridHeight, floorCount }`.
- For each `PURE_OP_CHECKS`: import the op, call it, compare deep-equal to `expected`.
- Compare each recorded value against `tests/snapshots.json`. If snapshot missing, write it and pass with `[baseline written]` message. If diff, print `expected ... got ...` and exit 1.

**Test Cases (the harness IS the test for everything else):**

```
$ node tests/smoke.js
✓ Solver: simple-cut (3 ops, BFS)
✓ Solver: rotate (4 ops, A*)
✓ Solver: stack (2 ops, A*)
✓ Solver: paint (3 ops, A*)
✓ Solver: pin-crystal (5 ops, A*)
✓ Solver: medium-astar (8 ops, A*)
✓ Solver: deep-ida (12 ops, IDA*)
✓ Layout: simple-layout (5 machines, 4 belts, 6×8)
✓ Op: cut-CuCuCuCu
✓ Op: stack-CuCuCuCu+RuRuRuRu
✓ Op: rotate90CW-CuRuSuWu
✓ Op: getSimilarity-CuCu+RuRu
[10/10 passed]
```

On regression:
```
✗ Solver: stack — expected numOps=2, got 3
[10/11 passed]
```

**Constraints:**
- The Worker→core split (Task 4a) hasn't happened yet at this task. To get an importable solver for the baseline run: create `tests/solverShim.js` that re-exports `shapeSolver`/`shapeExplorer` from a temporary copy or uses Node's `worker_threads` to drive the existing Worker. Simplest approach: copy the algorithm functions into a shim file for the baseline run, then delete the shim once Task 4a lands. **Alternative**: defer the solver portion of the smoke test until after Task 4a lands, and run only the layout + pure-op tests in Tasks 2–3. The Plan goes with the **alternative** — fewer moving parts.
- After Task 4a lands, the smoke test imports directly from `shapeSolverCore.js` and the full fixture set runs.
- All fixture inputs must be deterministic (same input → same output). The solver is deterministic given a fixed input (no randomness).
- `tests/snapshots.json` is committed to the repo. Intentional output changes require deleting the relevant snapshot entry and re-running.
- Snapshot format: `{ "Solver: simple-cut": { "numOps": 3, "pathLength": 4, "finalShapeCode": "..." }, ... }`.
- Smoke test runs in <30s on the 8 fixtures combined (solver fixtures must be small enough to terminate fast — keep targets simple).

**Verification:**
Run: `node tests/smoke.js`
Expected: First run writes baseline snapshot, exits 0 with `[baseline written]` lines. Second run prints all `✓`, exits 0.

**Commit after passing.**

`[Mode: Delegated]`

---

## Task 2: Split shapeOperations.js

**Files:**
- Create: `shapeClass.js`
- Create: `shapeOperationsHelpers.js`
- Create: `shapeAnalysis.js`
- Modify: `shapeOperations.js` (becomes orchestrator)
- Modify: `shapeSolver.js` (update internal imports — currently imports from `shapeOperations.js`)
- Modify: `main.js` only if any new imports needed (should not be — public surface unchanged)

**Contracts:**

`shapeClass.js` exports:
- Constants: `NOTHING_CHAR`, `SHAPE_LAYER_SEPARATOR`, `PIN_CHAR`, `CRYSTAL_CHAR`, `UNPAINTABLE_SHAPES`, `REPLACED_BY_CRYSTAL`
- Classes: `ShapePart`, `Shape`, `ShapeOperationConfig`, `InvalidOperationInputs`

`shapeOperationsHelpers.js` exports (used internally by `shapeOperations.js`):
- `_gravityConnected(part1, part2): boolean`
- `_crystalsFused(part1, part2): boolean`
- `_getCorrectedIndex(list, index): number`
- `_getConnectedSingleLayer(layer, index, connectedFunc): Set<number>`
- `_getConnectedMultiLayer(layers, layerIndex, partIndex, connectedFunc): Array<{layer,part}>`
- `_breakCrystals(layers, layerIndex, partIndex): void` (mutates layers)
- `_makeLayersFall(layers): void` (mutates)
- `_cleanUpEmptyUpperLayers(layers): void` (mutates)
- `_differentNumPartsUnsupported(func): wrappedFunc`

`shapeAnalysis.js` exports:
- `_extractLayers(shape, mode, includePins, includeColor): Array<...>`
- `_getPaintColors(inputShape, targetShape): Set<string>`
- `_getCrystalColors(shape): Set<string>`
- `_getSimilarity(shape1, shape2, weights?): number`
- `_getPartTypeCounts(shape): Object`
- `_getPartCounts(shape): Object`
- `_compareCounts(countsA, countsB): number`
- `_comparePartOrder(shape1, shape2): number`
- `_getRequiredColors(targetShape): Set<string>`
- `_getRequiredShapes(targetShape): Set<string>`
- `_filterStartingShapes(startingShapeCodes, targetShapeCode): Array<string>`

`shapeOperations.js` (orchestrator) exports:
- The 12 op functions: `cut`, `halfCut`, `rotate90CW`, `rotate90CCW`, `rotate180`, `swapHalves`, `stack`, `topPaint`, `pushPin`, `genCrystal`, `trash`, `beltSplit`
- `_getAllRotations`
- Re-exports from `shapeClass.js`: `Shape`, `ShapePart`, `ShapeOperationConfig`, `InvalidOperationInputs`, all constants
- Re-exports from `shapeAnalysis.js`: every `_` function above (so existing `import { _extractLayers, _filterStartingShapes } from './shapeOperations.js'` in `main.js` keeps working)

**Test Cases:**
The smoke test (Task 1) is the regression check. After this task:
```
$ node tests/smoke.js
[all ✓]
```
Plus visually:
- `shapeOperations.js` no longer contains the Shape class or analysis helpers.
- All four files compile-import cleanly: `node -e "import('./shapeOperations.js').then(m => console.log(Object.keys(m).length))"` prints a number ≥ 20.

**Constraints:**
- `main.js` import lines from `./shapeOperations.js` MUST work unchanged. Verify by reading `main.js` before and after.
- `shapeSolver.js` import lines from `./shapeOperations.js` MUST work unchanged.
- All function bodies are byte-for-byte identical to the originals (only file location changes).
- No new exports — only relocations and re-exports.
- New files use no first-line description comment (per Conventions in CLAUDE.md, added in Task 6).

**Verification:**
Run: `node tests/smoke.js && node -e "import('./shapeOperations.js').then(m => { console.log('ops exports:', Object.keys(m).length); })"`
Expected: smoke test all pass; export count ≥ 20.

**Commit after passing.**

`[Mode: Delegated]`

---

## Task 3: Split blueprintLayout.js

**Files:**
- Create: `blueprintTopology.js`
- Create: `blueprintPositions.js`
- Create: `blueprintRouting.js`
- Modify: `blueprintLayout.js` (becomes orchestrator)

**Contracts:**

`blueprintTopology.js` exports:
- `extractTopology(solutionPath): { nodes, edges, sources, producedBy }`
- `topoSort(topology): Array<number>`
- `groupIntoRows(sortedSteps, topology, solutionPath): Map<number, Array<number>>`

`blueprintPositions.js` exports:
- `assignPositions(rows, solutionPath, topology): { machines, belts, gridWidth, gridHeight, floors }` (or whatever the current return shape is — must match exactly)

`blueprintRouting.js` exports:
- `routeBelt(belts, fromX, fromY, fromFloor, toX, toY, toFloor, shapeCode, def, inputIndex): void` (mutates `belts`)

`blueprintLayout.js` (orchestrator) exports:
- `buildLayout(solutionPath)` — calls `extractTopology` → `topoSort` → `groupIntoRows` → `assignPositions` → returns layout (current behavior)
- `duplicateForThroughput(layout, multiplier)`

**Test Cases:**
The smoke test's `LAYOUT_FIXTURES` is the regression check. After this task:
```
$ node tests/smoke.js
[Layout: ✓ ...]
```

**Constraints:**
- `main.js` import lines from `./blueprintLayout.js` (`buildLayout`, `duplicateForThroughput`) MUST work unchanged.
- All function bodies byte-identical to originals.
- Constants used by multiple new files (e.g., `MACHINE_GAP`, `ROW_PITCH` if they exist) must live in one file and be imported by the others — choose `blueprintPositions.js` as their home if `assignPositions` uses them most.
- `routeBelt` must remain mutating its `belts` argument — do not change to return-a-new-array.

**Verification:**
Run: `node tests/smoke.js`
Expected: Layout fixtures pass with identical snapshot values.

**Commit after passing.**

`[Mode: Delegated]`

---

## Task 4a: Extract shapeSolver Algorithm to shapeSolverCore.js (Worker→Core Split)

**This is the highest-risk single commit. Do this as a standalone task before any further solver decomposition.**

**Files:**
- Create: `shapeSolverCore.js`
- Modify: `shapeSolver.js` (becomes thin Worker wrapper, ~30 lines)
- Modify: `tests/smoke.js` to import from `shapeSolverCore.js` and add the solver fixtures (deferred from Task 1)
- Modify: `tests/snapshots.json` (add solver baselines on first run)

**Contracts:**

`shapeSolverCore.js` exports:
```js
export async function shapeSolver(
  targetShapeCode,
  startingShapeCodes,
  enabledOperations,
  maxLayers,
  maxStatesPerLevel = Infinity,
  preventWaste,
  orientationSensitive,
  monolayerPainting,
  heuristicDivisor = 0.1,
  searchMethod = 'A*',
  shouldCancel = () => false,    // NEW: replaces internal `cancelled` reads
  onProgress = () => {}          // NEW: replaces internal `self.postMessage({type:'status'})` calls
): Promise<{ /* current return shape */ }>;

export async function shapeExplorer(
  startingShapeCodes,
  enabledOperations,
  depthLimit,
  maxLayers,
  shouldCancel = () => false,
  onProgress = () => {}
): Promise<{ /* current return shape */ }>;
```

Also exports `operations` table (used by both core and potentially future smoke fixtures).

`shapeSolver.js` (Worker wrapper) becomes:
```js
import { shapeSolver, shapeExplorer } from './shapeSolverCore.js';

let cancelled = false;
const shouldCancel = () => cancelled;
const onProgress = (message) => self.postMessage({ type: 'status', message });

self.onmessage = async function (e) {
  const { action, data } = e.data;
  if (action === 'solve') {
    cancelled = false;
    try {
      const result = await shapeSolver(/* spread data + shouldCancel + onProgress */);
      if (!cancelled) self.postMessage({ type: 'result', result });
    } catch (err) {
      self.postMessage({ type: 'status', message: `Error: ${err.message}` });
    }
  } else if (action === 'explore') {
    cancelled = false;
    try {
      const graph = await shapeExplorer(/* + shouldCancel + onProgress */);
      if (!cancelled) self.postMessage({ type: 'result', result: graph });
    } catch (err) {
      self.postMessage({ type: 'status', message: `Error: ${err.message}` });
    }
  } else if (action === 'cancel') {
    cancelled = true;
    self.postMessage({ type: 'status', message: 'Cancelled.' });
  }
};
```

**Behavior changes in `shapeSolverCore.js`:**
- Every `if (cancelled) ...` becomes `if (shouldCancel()) ...`.
- Every `self.postMessage({ type: 'status', message: '...' })` becomes `onProgress('...')`.
- The `operations` table, `PriorityQueue`, `getCachedShape` and friends, inverse ops, and `buildBackwardReachability` stay in `shapeSolverCore.js` for now (extracted in Task 4b).
- The top-level `cancelled` variable is REMOVED from core (it lives in the Worker wrapper now).
- `shapeSolver` and `shapeExplorer` are now **exported** (currently they're not).

**Test Cases:**

Add to `tests/fixtures.js` `SOLVER_FIXTURES`:
```js
{ name: 'simple-cut', target: '<TBD by implementer — pick a 3-op solve>', starting: [...], ops: ['Cutter'], maxLayers: 1, method: 'BFS', preventWaste: false, orientationSensitive: false, monolayerPainting: false },
{ name: 'rotate', ... method: 'A*' },
{ name: 'stack', ... method: 'A*' },
{ name: 'paint', ... method: 'A*' },
{ name: 'pin-crystal', ... method: 'A*' },
{ name: 'medium-astar', ... method: 'A*' },
{ name: 'deep-ida', ... method: 'IDA*' },
```

Implementer picks fixture inputs by running the existing solver in the browser (or via the new core in Node) once, recording 6-7 small but representative inputs whose outputs become the baseline snapshots. Each must terminate in <3 seconds.

After implementation:
```
$ node tests/smoke.js
[all 12+ ✓]
```

Manual browser verification (REQUIRED before committing this task):
- Open the local site, run a long-ish solve, click Cancel mid-search → status shows "Cancelled.", search stops.
- Run a normal solve → result appears, intermediate status messages appear in the UI.
- Run shape explore mode → graph populates.

**Constraints:**
- `main.js`'s `new Worker(new URL('./shapeSolver.js', import.meta.url), { type: 'module' })` MUST keep working — Worker entry filename unchanged.
- Worker message protocol unchanged (action types, response types).
- Cancellation latency unchanged (the `shouldCancel()` call sites are the same as the old `cancelled` reads).
- `onProgress` is called at the same frequency and with the same message strings as the old `self.postMessage({type:'status'})` calls.
- No re-ordering of operations within the algorithm — preserve every line's execution order to avoid subtle behavior changes.

**Verification:**
Run: `node tests/smoke.js && open https://mase.fi/shapez (local)`
Expected: smoke passes; manual browser checks pass (cancel, normal solve, explore).

**Commit after passing.**

`[Mode: Delegated]`

---

## Task 4b: Extract Solver Sub-Modules from shapeSolverCore.js

**Files:**
- Create: `shapeSolverPriorityQueue.js`
- Create: `shapeSolverCache.js`
- Create: `shapeSolverInverse.js`
- Create: `shapeSolverBackward.js`
- Modify: `shapeSolverCore.js` (imports from new files instead of defining inline)

**Contracts:**

`shapeSolverPriorityQueue.js`:
```js
export class PriorityQueue { /* unchanged */ }
```

`shapeSolverCache.js`:
```js
export const shapeCache;  // module-scoped Map
export function getCachedShape(code): Shape;
export function getCachedOpResult1(opName, fn, inputShape, config): Shape | null;
export function getCachedOpResult1Color(opName, fn, inputShape, color, config): Shape | null;
export function getCachedOpResult2(opName, fn, inputShape1, inputShape2, config): Shape | null;
```
Note: caches are module-level (shared across all solver invocations within a worker session). Same as today — moving them out doesn't change scope.

`shapeSolverInverse.js`:
```js
export function inverseUnpaint(shape, config): Set<string>;
export function inverseRotateCW(shape, config): Set<string>;
export function inverseRotateCCW(shape, config): Set<string>;
export function inverseRotate180(shape, config): Set<string>;
export function inverseUnstack(shape, config): Array<{shape1, shape2}>;
export function inverseUncut(shape, config): Array<{shape1, shape2}>;
export function inverseUnpin(shape, config): Set<string>;
```

`shapeSolverBackward.js`:
```js
export function buildBackwardReachability(targetShapeCode, config, enabledOperations, maxDepth): Set<string>;
```

`shapeSolverCore.js` after extraction:
- Imports `PriorityQueue` from `./shapeSolverPriorityQueue.js`
- Imports cache helpers from `./shapeSolverCache.js`
- Imports inverse ops from `./shapeSolverInverse.js`
- Imports `buildBackwardReachability` from `./shapeSolverBackward.js`
- Keeps: exported `shapeSolver`, `shapeExplorer`, `operations` table, all closures inside `shapeSolver`

**Test Cases:**
```
$ node tests/smoke.js
[all ✓]
```

**Constraints:**
- All function bodies byte-identical.
- Module-level caches in `shapeSolverCache.js` work correctly across multiple `getCachedShape` calls from `shapeSolverCore.js` (verify by running smoke test twice — second run should be faster due to cache hits).
- Inverse ops in their new file must continue to work with `Shape` instances from `shapeClass.js` (verify imports).

**Verification:**
Run: `node tests/smoke.js`
Expected: All fixtures pass with same snapshot values as Task 4a baseline.

**Commit after passing.**

`[Mode: Delegated]`

---

## Task 5: Split blueprintRenderer.js

**Files:**
- Create: `blueprintColors.js`
- Create: `blueprintDrawing.js`
- Modify: `blueprintRenderer.js` (class shrinks to state/lifecycle/event handling, calls drawing functions)
- Modify: `main.js` only if `BlueprintRenderer` import path changes (it shouldn't — original filename stays)

**Contracts:**

`blueprintColors.js`:
```js
export function machineColor(operation): string;
export function darken(hex, amount = 0.3): string;
```

`blueprintDrawing.js`:
```js
// Each previously-private _drawXxx method becomes a standalone function.
// Signatures take ctx + state primitives (NOT `this`).

export function drawScene(ctx, viewW, viewH, panX, panY, zoom, layout, visibleBelts, floor, /* ... */): void;
export function drawGrid(ctx, gridWidth, gridHeight, /* ... */): void;
export function drawBelts(ctx, visibleBelts, /* belt-related state */): void;
export function drawMachines(ctx, /* machine state */): void;
// ... etc. for every existing _draw* method
```

The exact param list per function is determined by reading the current `this._foo` accesses in each method and threading them as parameters.

`blueprintRenderer.js` (class) keeps:
- `constructor(canvas)`
- `setLayout(layout)`
- `setFloor(floorIndex)`
- `exportPng()`
- `destroy()`
- `_handleResize()`
- `_filterFloor()`
- `_centerView()`
- `_render()` — calls `drawScene(ctx, ..., this._layout, this._visibleBelts, this._floor, ...)` — i.e., `_render` becomes the param-threading site

**Test Cases:**

The smoke test does NOT cover the renderer (canvas is hard to unit-test). Manual browser verification is required:
- Load local site, switch to Blueprint tab → canvas renders machines and belts as before
- Pan/zoom on blueprint → smooth, no glitches
- Hover over a machine → tooltip shows
- Switch floor (if multi-floor layout) → only that floor's machines visible
- Export PNG → file downloads, image looks correct
- Switch to Flowchart tab and back → renderer destroys/recreates cleanly, no console errors

**Constraints:**
- `main.js`'s `import { BlueprintRenderer } from './blueprintRenderer.js'` MUST keep working.
- All draw output is visually identical (same colors, sizes, positions, font metrics).
- `BlueprintRenderer` class instance API unchanged (`setLayout`, `setFloor`, `exportPng`, `destroy` all still public methods).
- No first-line description comments on new files.

**Verification:**
Run: `node tests/smoke.js` (regression sanity), then manually walk through the 6 browser checks above.
Expected: smoke still passes; visual output unchanged.

**Commit after manual verification passes.**

`[Mode: Delegated]`

---

## Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Contracts:**

Three changes to `shapez2-solver/CLAUDE.md`:

**1. Project Structure section** — Replace the current per-file flat list with one prose sentence:

> Each of the four major modules — `shapeOperations`, `shapeSolver`, `blueprintLayout`, `blueprintRenderer` — is a public-entry-point file with a small set of sibling helper files prefixed by the same name (e.g., `shapeSolverCache.js`, `blueprintTopology.js`). `shapeSolver.js` is a thin Web Worker wrapper around the algorithm in `shapeSolverCore.js`.

**2. Known Issues / Tech Debt** — Remove this line:

> - Several files exceed 300 lines (shapeOperations.js, blueprintLayout.js, shapeSolver.js, blueprintRenderer.js) — candidates for splitting

Leave the other tech debt items.

**3. Add new "Conventions" section** (place above "Roadmap & Ideation"):

```markdown
## Conventions

- **No first-line description comments on source files.** This is a public repo; filenames are descriptive enough. The auto-generated context tree convention used in private projects does not apply here.
- **Orchestrator exception to the 300-line rule.** Two files intentionally exceed 300 lines because their job is coordinating tightly-coupled steps that don't extract cleanly:
  - `shapeSolverCore.js` (~700 lines) — the search algorithm has many inner closures over shared state (caches, target, config, shape map). Extracting them would require passing 5–10 args per call or restructuring around a SolverContext object — both worse than the current shape.
  - `blueprintPositions.js` (~300 lines) — `assignPositions` is a sequential pipeline (compute widths → place sources → place machines → resolve overflow → ...) where each phase reads/writes shared local state. Best read top-to-bottom in one place.
- **Smoke test before commit.** Run `node tests/smoke.js` after any change to solver, layout, or shape-operations code.
```

**Test Cases:**
None — doc-only change.

**Constraints:**
- Don't introduce new sections not specified above.
- Don't reformat unchanged sections.

**Verification:**
Visual diff. The three changes are present; nothing else was touched.

**Commit after applying.**

`[Mode: Direct]`

---

## Task 7: Final Browser Verification + Deploy

**Files:**
- None modified — verification + deploy step.

**Contracts:**
None.

**Test Cases (manual checklist):**

Open `https://mase.fi/shapez/` locally (after `python3 -m http.server` in the project dir, or via the existing dev workflow):

1. Page loads with no console errors.
2. Default starting shapes appear in the UI.
3. Run a simple solve (e.g., target `CuRuSuWu`) → result appears as flowchart.
4. Switch to Blueprint tab → canvas shows machines and belts.
5. Pan/zoom on Blueprint → smooth.
6. Hover a machine → tooltip appears.
7. Switch back to Flowchart tab → still works, no errors.
8. Run a long solve → click Cancel mid-search → "Cancelled." status appears, search stops.
9. Run shape Explore mode → graph appears.
10. Change color mode (RGB → RYB → CMYK) → shapes re-render correctly.
11. Export Blueprint PNG → file downloads.

**Constraints:**
- All 11 checks must pass before deploy.
- `node tests/smoke.js` must pass before deploy.

**Verification:**
After all checks pass: `deploy --update feature "Modularize 4 large source files; add smoke test harness"`

**Commit:** No commit needed for this task itself (verification only).

`[Mode: Direct]`

---

## Execution
**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks: Opus implements directly (Tasks 6, 7)
- Mode B tasks: Dispatched to subagents (Tasks 1, 2, 3, 4a, 4b, 5)
