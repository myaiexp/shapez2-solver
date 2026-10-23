# Solver internals

Search methods, budgets, the space-explorer bound, and the Constructive planner. The Constructive design itself is in [2026-06-11-recursive-decompose-search-design.md](plans/2026-06-11-recursive-decompose-search-design.md).

## A\* coverage heuristic

Solver A\* uses a per-slot **clean sub-shape coverage** heuristic (`createCoverageHeuristic` in `shapeSolverHeuristic.js`, idea #1677): each target (layer, quadrant) is scored by the cheapest way any held shape can supply it (0 if a clean piece already covers it, up to 3 to isolate, 4 to fabricate), summed, plus the stacks still needed. `heuristicDivisor` (default 0.1) then weights it (weighted A\*, W = 1/divisor), so it's intentionally inadmissible for speed and paths aren't guaranteed shortest — use a larger divisor or BFS for more optimal/bounded search.

Idea #6540 fixed four ways the estimate rewarded the wrong moves. The why for each is in the module header:

- An orientation-insensitive goal is scored against each target rotation separately, and the cheapest is taken. Held pieces must agree on one rotation of the target.
- A piece held in the wrong rotation costs 1 more.
- A shape matches at any layer offset, because a Stacker lifts it there. This stops Pin Pusher looking like progress.
- The stack term counts only the clean pieces a greedy cover needs, so merging spare copies is not progress either.

## State key

A search state is the multiset of held shape codes, **exact** — rotations are never folded together, even when orientation-insensitive. Cutter, Half Destroyer and Swapper act on a fixed axis, and Stacker depends on the inputs' relative rotation, so a rotated shape builds different things. Folding rotations (the old per-shape canonicalization) made every Rotator step revisit its parent state, which left `Cu------` unreachable from `CuCuCuCu` and capped the default-start solves (idea #6540). Orientation-insensitivity lives only in the goal check (`acceptableCodes`).

## Three budgets

Keep the names separate end-to-end.

| Name | Role | Browser | Harness (`solve.mjs`) |
| --- | --- | --- | --- |
| `maxStates` | Global distinct-state ceiling | Omitted → `Infinity`. Relies on Cancel (an OOM only crashes the user's tab). | `--max-states N`, default 100k so hard targets can't OOM helm's cgroup |
| `maxStatesPerLevel` | BFS beam width (per-depth prune) | Shared `#max-states-per-level` input, labelled "Max States Per Level" | (core BFS option; not a Constructive flag) |
| `nodeBudget` | Constructive per-node A\* cap (fail-fast → decompose) | Same DOM input, relabelled "Node Search Budget", sent as `nodeBudget` | `--node-budget N`, default 4000 |

Never call the shared input "Max States" — that name is the global `maxStates` ceiling.

On the global cap the search aborts gracefully with `{ aborted: 'maxStates' }`. Successor ids are minted lazily (only for states the search keeps), so the `shapes` Map no longer grows with every edge generated (idea #1675).

The worker dispatches `searchMethod==='Constructive'` to `solveConstructive` (core never imports the planner → no cycle), reusing the shared budget input (`maxStatesPerLevel` for BFS, relabelled "Node Search Budget" and sent as `nodeBudget` for Constructive) — not the global `maxStates` ceiling, which the browser leaves uncapped.

## Belt Split in forward search

The state is a multiset of shape codes, so a Belt Split adds one more copy of a held code (`expandBeltSplit`, `shapeSolverExpansion.js`, idea #4716). This is what makes same-shape stacks like `CuCuCuCu:CuCuCuCu` from one `CuCuCuCu` start reachable. The split is refused once the state would hold more than `maxLayers` copies of that code: no stack uses more copies of one shape than it has layers, and an uncapped split would multiply the frontier. The space explorer does not draw splits, because its nodes are distinct codes and a split would be a self-loop.

## Space-explorer bounds

The explorer's BFS re-applies every enabled op across the whole frontier each level, so the graph grows multiplicatively with depth: at the UI defaults (4 starts, all ops) depth 2 is 2052 shapes + 2846 ops, while uncapped depth 3 runs through gigabytes of heap without finishing. `exploreDepth.js` holds two bounds:

- **Depth** is clamped to 1–8 (empty/invalid → 2) at both the UI parse and the worker boundary.
- **Nodes**: `shapeExplorer`'s `maxNodes` caps shape + op nodes, mirroring the solver's `maxStates`. When the next op would exceed it, expansion stops and the partial graph comes back with `{ aborted: 'maxNodes', depth }`, where `depth` is the level that was cut short. The worker always passes `DEFAULT_EXPLORE_MAX_NODES` (6000), which bounds what `renderSpaceGraph` hydrates on the main thread and still holds the complete default-depth graph. `solutionPresentation.js` (`exploreStatus`) reports the cap in the status line.

The BFS posts `Exploring depth d/N...` at each level and every ~100 ms within one, yielding to the event loop each time so the worker's cancel flag can be set mid-run. `node tests/shared/solve.mjs --explore N` calls `shapeExplorer` directly: depth is unclamped and `--max-nodes` defaults to 100k, because `--timeout` alone does not bound memory.

## Constructive method

Since idea #6540, forward A\* finds single-layer four-quadrant targets from the default starts: `CuRuSuWu` takes 12 ops and about 4.5k states. Mixed multi-layer targets (`CuRuSuWu:WuSuRuCu`, three-layer patterns) still exceed 100k states. The cause is **frontier width**: thousands of near-equivalent partial assemblies in the multiset-of-shapes state space.

The **Constructive** method (`shapeSolverConstructive.js` planner + `shapeSolverDecompose.js` splits/cost + `shapeSolverFlatten.js` Plan-tree → path and result) tries the bounded core A\* first at every node (so clever shortcuts like `CuCuRuRu`→1 Swapper are preserved), and only on a cap does it split the target (by-quadrant / by-half / by-layer), recurse on the pieces, and pick the cheapest assembled plan by reuse-credited op count (decomposition depth as tie-break).

- **Pieces are searched orientation-sensitive** so each lands in its exact target quadrant and assembly `stack`s gravity-merge with no rotation.
- Memoised sub-targets are built once (ids offset into disjoint global ranges) and their product **copied per consumer** — an explicit `Belt Split` chain, or a second feed when the piece is itself a starting shape. Handing one id to two consumers is unbuildable (the blueprint has a single output port per id) and is what `invalidPathIds` in the shared test harness rejects.
- **Scope is Tier-1**: uncolored flat structural shapes (C/R/S/W in any arrangement, single- or multi-layer); color/crystal/pin tiers are deferred.
- Decomposition candidates whose left-fold `stack` product is not the parent (gappy complementary multi-layer pairs that gravity-collapse, e.g. `CuCu----:----SuSu`) are rejected — floating upper parts need pins/crystals (out of Tier-1).

Abort reasons (all mapped in `constructiveResult`, `shapeSolverFlatten.js`; a cancelled solve reports `aborted: null`). The planner's `stackProduct` check stops mis-assembled plans before flatten, so no real solve reaches `path-invalid` — `tests/solver/shapeSolverFlatten.test.js` drives it with hand-built Plan trees:

- `{ aborted: 'no-decomposition' }` — no solving split remains
- `{ aborted: 'preventWaste' }` — a plan exists but leftovers cannot be trashed (Trash disabled under preventWaste)
- `{ aborted: 'path-invalid' }` — flatten yields a path whose final inventory lacks the target (assembly/id bug, not a missing split)

Final-inventory predicates (`pathReachesTarget`, `pathInventoryAcceptable`, `acceptableCodes`, unused-start multiset) live in production `pathInventory.js` (shared with the harness gate) so preventWaste scrub and CI stay lockstep.

## Intentional limits

**Paint is free.** The solver treats every paintable color as an input the Painter can apply. It does not model the Color Mixer, or the steps that produce a fluid (white+white → black, and the rest of the 1.0 mixing table). Mixing is upstream of the shape recipe: counting mixer steps would change the cost model and the operation set without changing which shapes are reachable. A blueprint therefore understates factory cost for a derived color, on purpose.

**Refined X/Y are starting shapes.** X and Y are unpaintable (`UNPAINTABLE_SHAPES` in `shapeClass.js`) and the operation table has no Trade Station. A colored exotic (for example `Xr`) is solvable only when that exact shape is supplied as a start. Structural ops already treat X/Y as ordinary solid parts. A refine pseudo-op is not a shape operation: a Trade Station's output is an economic choice, not a function of its inputs.
