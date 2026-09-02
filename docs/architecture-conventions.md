# Architecture conventions

## No first-line description comments

This is a public repo; filenames are descriptive enough. The auto-generated context tree convention used in private projects does not apply here.

## 300-line rule and orchestrator exceptions

No source file over 300 lines. If adding code would push a file past 300, split it first. Don't preemptively split files comfortably under the limit.

A few files intentionally exceed 300 lines because they coordinate tightly-coupled steps that don't extract cleanly. Counts below are coarse bands (not exact `wc -l`) so they don't churn on every edit:

- **`shapeSolverCore.js` (700+)** — the search algorithm has many inner closures over shared state (caches, target, config, shape map). Extracting them would require passing 5–10 args per call or restructuring around a SolverContext object — both worse than the current shape. (A\*/Bidirectional share one `runBestFirst` helper since they differ only by heuristic. The space explorer — which shares none of these closures — lives in its own `shapeExplorerCore.js`, importing only the `operations` table from here.)
- **`main.js` (600+)** — DOM app entry point. Each handler wires one named button/event to an imported module; most lines are glue, not logic. Splitting would scatter shared module-level state (solver worker, blueprint renderer, current layout, persistence flags) across files with circular dependencies.
- **`blueprintRenderer.js` (400+)** — class shell that owns canvas state, event handlers, tooltip DOM, and the public API. Each method does one named thing; splitting tooltip/events into separate modules would require threading instance state through.
- **`shapeSolverConstructive.js` (350+)** — Constructive planner orchestrator: bounded core search, then split/recurse/assemble, then flatten + preventWaste scrub. Inner closures over the memoised Plan tree, disjoint id-offset ranges, and per-consumer copies. Split logic already lives in `shapeSolverDecompose.js`; pulling the rest out would thread Plan-tree state through every helper.
- **`blueprintPositions.js` (300+)** — `assignPositions` is a thin orchestrator over a forward-flowing placement pipeline: `placeMachines` → `buildPortLookup` → `propagateBeltSplits` → `routeAllBelts` → `computeFloorCount`, each a single-purpose function. The phases share the `ROW_PITCH`/`MACHINE_GAP` constants this file exports (and `blueprintLayout` imports back), so hoisting them into a separate module would create a circular import and fragment a tightly-coupled pipeline. Kept in one file as the pipeline coordinator.

Prefix-grouped siblings of these files (e.g. `shapeSolverCache.js`, `blueprintTopology.js`) are the intended split surface when a new concern actually separates.
