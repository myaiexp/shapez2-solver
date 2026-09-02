# Solver internals

Search methods, budgets, the space-explorer bound, and the Constructive planner. The Constructive design itself is in [2026-06-11-recursive-decompose-search-design.md](plans/2026-06-11-recursive-decompose-search-design.md).

## A\* coverage heuristic

Solver A\* uses a per-slot **clean sub-shape coverage** heuristic (`getHeuristic`/`_matchAndCoverage` in `shapeSolverCore.js`, idea #1677): each target (layer, quadrant) is scored by the cheapest way any held shape can supply it (0 if a clean piece already covers it, up to 3 to isolate, 4 to fabricate), summed, plus a stack-to-merge term. `heuristicDivisor` (default 0.1) then weights it (weighted A\*, W = 1/divisor), so it's intentionally inadmissible for speed and paths aren't guaranteed shortest — use a larger divisor or BFS for more optimal/bounded search.

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

## Space-explorer depth bound

The space explorer has no state cap — its BFS re-applies every enabled op across the whole frontier each level, so depth is the only bound on growth. `exploreDepth.js` therefore clamps it to 1–8 (empty/invalid → 3) at both the UI parse and the worker boundary. `node tests/shared/solve.mjs --explore N` calls `shapeExplorer` directly and stays unclamped for deliberate deep runs.

## Constructive method

Multi-distinct-quadrant targets are **not** found by forward search at any reasonable cap. Reachable, genuinely simple targets like `CuRuSuWu` (one quadrant cut from each of the four default starts, then stacked, ~15 ops) miss A\*/BFS/IDA\*/Bidirectional because of **frontier width / state multiplicity near the goal** — thousands of near-equivalent partial assemblies over the multiset-of-shapes state space. The coverage heuristic improved the gradient but did not breach this structural limit.

The **Constructive** method (`shapeSolverConstructive.js` + `shapeSolverDecompose.js`) tries the bounded core A\* first at every node (so clever shortcuts like `CuCuRuRu`→1 Swapper are preserved), and only on a cap does it split the target (by-quadrant / by-half / by-layer), recurse on the pieces, and pick the cheapest assembled plan by reuse-credited op count (decomposition depth as tie-break).

- **Pieces are searched orientation-sensitive** so each lands in its exact target quadrant and assembly `stack`s gravity-merge with no rotation.
- Memoised sub-targets are built once (ids offset into disjoint global ranges) and their product **copied per consumer** — an explicit `Belt Split` chain, or a second feed when the piece is itself a starting shape. Handing one id to two consumers is unbuildable (the blueprint has a single output port per id) and is what `invalidPathIds` in the shared test harness rejects.
- **Scope is Tier-1**: uncolored flat structural shapes (C/R/S/W in any arrangement, single- or multi-layer); color/crystal/pin tiers are deferred.
- Decomposition candidates whose left-fold `stack` product is not the parent (gappy complementary multi-layer pairs that gravity-collapse, e.g. `CuCu----:----SuSu`) are rejected — floating upper parts need pins/crystals (out of Tier-1).

Abort reasons:

- `{ aborted: 'no-decomposition' }` — no solving split remains
- `{ aborted: 'preventWaste' }` — a plan exists but leftovers cannot be trashed (Trash disabled under preventWaste)
- `{ aborted: 'path-invalid' }` — flatten yields a path whose final inventory lacks the target (assembly/id bug, not a missing split)

Final-inventory predicates (`pathReachesTarget`, `pathInventoryAcceptable`, `acceptableCodes`, unused-start multiset) live in production `pathInventory.js` (shared with the harness gate) so preventWaste scrub and CI stay lockstep.
