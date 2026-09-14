# Architecture conventions

## No bare file-purpose comments

This is a public repo; filenames are descriptive enough, and the private-project convention of a one-line purpose comment atop every file (for an auto-generated context tree) does not apply here. Don't add a first-line comment that only restates what the filename already says.

A header comment stays when it carries something the filename can't: attribution for ported code (`shapeOperations.js`, `shapeRotation.js`, `shapeRendering.js` credit Loupau38), a usage contract (`shapeOperationsTestUtils.js`), or a non-obvious why or invariant (`colorMode.js`, `exploreDepth.js`, `shapeHalfGeometry.js`'s quadrant indexing). Session tooling shows those first lines as file descriptions; that is a side effect, not a reason to add one.

## 300-line rule and orchestrator exceptions

No source file over 300 lines. If adding code would push a file past 300, split it first. Don't preemptively split files comfortably under the limit.

A few files intentionally exceed 300 lines because they coordinate tightly-coupled steps that don't extract cleanly. Counts below are coarse bands (not exact `wc -l`) so they don't churn on every edit:

- **`shapeSolverCore.js` (700+)** — the search algorithm has many inner closures over shared state (caches, target, config, shape map). Extracting them would require passing 5–10 args per call or restructuring around a SolverContext object — both worse than the current shape. (A\*/Bidirectional share one `runBestFirst` helper since they differ only by heuristic. The space explorer — which shares none of these closures — is a separate module, `shapeExplorerCore.js`. It does not import this file; it shares only the leaf helpers both searches use: the `operations` table (`shapeSolverOperations.js`), the shape and op-result caches (`shapeSolverCache.js`), unary/binary expansion (`shapeSolverExpansion.js`), and crystal colors (`shapeColorAnalysis.js`).)
- **`main.js` (600+)** — DOM app entry point. Each handler wires one named button/event to an imported module; most lines are glue, not logic. Splitting would scatter shared module-level state (solver worker, blueprint renderer, current layout, persistence flags) across files with circular dependencies.
- **`blueprintRenderer.js` (400+)** — class shell that owns canvas state, event handlers, tooltip DOM, and the public API. Each method does one named thing; splitting tooltip/events into separate modules would require threading instance state through.
- **`blueprintPositions.js` (300+)** — `assignPositions` is a thin orchestrator over a forward-flowing placement pipeline: `placeMachines` → `buildPortLookup` → `propagateBeltSplits` → `routeAllBelts` → `computeFloorCount`, each a single-purpose function. The phases share the `ROW_PITCH`/`MACHINE_GAP` constants this file exports (and `blueprintLayout` imports back), so hoisting them into a separate module would create a circular import and fragment a tightly-coupled pipeline. Kept in one file as the pipeline coordinator.

Prefix-grouped siblings of these files (e.g. `shapeSolverCache.js`, `blueprintTopology.js`) are the intended split surface when a new concern actually separates. The Constructive planner is the worked example: split logic lives in `shapeSolverDecompose.js` and Plan-tree flattening plus the abort mapping in `shapeSolverFlatten.js`, which takes the Plan tree and a plain options object rather than closing over planner state — so `shapeSolverConstructive.js` stays under the limit and the abort codes are testable with hand-built Plan trees.
