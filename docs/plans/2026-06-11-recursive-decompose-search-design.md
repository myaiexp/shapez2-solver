# Recursive Decompose-and-Search Planner ("Constructive" method)

> Design doc — 2026-06-11. Addresses the headline known-issue: the solver cannot find
> simple multi-distinct-quadrant targets (e.g. `CuRuSuWu`) within any reasonable state
> budget (idea #1677). Forward best-first search hits a structural frontier-width wall;
> this adds a constructive planner that sidesteps it.

## Background & goal

The coverage heuristic (commit `fe8ddc7`) massively improved A*'s gradient — it now
descends to depth ~12 in <800 states — but `CuRuSuWu` and the whole
multi-distinct-quadrant class still don't solve within the cap. The residual wall is
**frontier width over the powerset-of-shapes state space**: thousands of near-equivalent
partial assemblies near the goal, a structural limit of blind forward search confirmed
empirically across every heuristic/tuning/method.

The fix is **constructive decomposition**, but the explicit design goal is *intelligence,
not a rote make-anything-machine*. A naive "decompose target → rebuild" recipe is **worse**
than today's search on targets search already handles (`CuCuRuRu` solves in **1 Swapper**;
rote quadrant decomposition would take ~11 ops). So the planner must *preserve* the
cleverness search finds and only decompose when search alone fails.

**Success criterion:** produce **minimum-cost, cleverness-preserving** plans. The plan
(flowchart) is the product; the blueprint reflects whatever clever plan the planner found,
later. Reuse-credited op count is the operational definition of "intelligent".

## Mechanism (M1): recursive decompose-and-search

```
solvePlan(target, budget):
    # 1. Try the real search first, bounded — clever shortcuts surface here
    path = search(target, maxStates = budget)
    if path.solved:
        return { plan: path, method: 'direct-search' }

    # 2. Otherwise decompose: enumerate candidate splits, recurse on the pieces
    candidates = []
    for split in [byLayer, byQuadrant, byHalf](target):   # whichever apply
        subPlans = [ solvePlan(piece, budget) for piece in split.pieces ]
        if all subPlans solved:
            candidates.append( assemble(subPlans, split.assembly) )

    # 3. Return the cheapest assembled plan (or fail if none apply)
    return min(candidates, by = cost)
```

**Why it's intelligent, not rote:** search runs *first at every node*, so a clever
shortcut surfaces wherever it exists — the whole target or any sub-piece. Decomposition
only shrinks a too-hard search into search-sized pieces. Output is the cheapest of
`{direct search} ∪ {best decomposition}`, so it can never be worse than today's search on
targets search already cracks.

**Termination & speed:**
- **Strict simplification** — every split's pieces are structurally simpler than the
  parent (fewer distinct quadrants / fewer layers), so recursion bottoms out at primitives
  (`Cu------`, a single clean layer) that the bounded search solves instantly in step 1.
- **Memoization by shape-code** — identical sub-targets solve once and are reused. This
  memo table is also exactly what a future pattern-DB (M2 / idea #3) would consume.
- **Per-node budget** — base-case search is invoked with a *finite* `maxStates` (a few
  thousand), so a base case that's secretly hard fails fast and triggers decomposition
  rather than running uncapped.

## Splits & assembly

The key elegance: **the planner itself only ever emits `stack` for assembly.** All
cutting, rotating, and cleverness lives *inside* the recursively-solved pieces (each
base-case search produces its piece already positioned). Assembly is uniform and dumb;
intelligence is at the leaves.

| Split | Pieces | Assembly | When it wins |
|---|---|---|---|
| **by-layer** | each layer as a single-layer sub-target | `stack` bottom→top in layer order (gravity adds the separator) | multi-layer targets — the only way to peel layers |
| **by-quadrant** | each occupied quadrant as a *positioned* single-quadrant sub-target (`Cu------`, `--Ru----`, …) | `stack` the pieces in any order — gravity merges disjoint same-layer quadrants (`Cu------`+`--Ru----`→`CuRu----`) | universal fallback for any flat layer |
| **by-half** | left + right halves as 2-quadrant sub-targets | one `stack` (disjoint positions merge cleanly) | lets the search find a half-level trick (e.g. a Swapper) on a bigger piece |

**Completeness:** by-layer + by-quadrant alone is *universally complete* for Tier-1
shapes (any flat multi-layer shape decomposes layer→quadrant→single piece, all base
cases). **by-half is purely an extra candidate** for cheaper/cleverer plans — cost
selection discards it if not cheaper, so it can only help.

**Why assembly is always `stack`:** each piece sub-target is the *positioned* sub-shape,
so `solvePlan(piece)` is responsible for getting it to the right quadrant (search uses
`cut`+`rotate` — shallow, exactly what search is good at). Disjoint positioned pieces then
gravity-merge under a plain `stack`. `swapHalves` never appears in the *assembler* — it
only shows up when the *search* discovers it inside a piece or at the top-level direct
attempt. (Verified against the real ops: `stack` in `shapeOperations.js:128` runs
`_makeLayersFall`; `cut` at `:59`; `swapHalves` at `:97`. Single-quadrant shapes remain
4-part, so `stack`/`swapHalves`'s same-`numParts` requirement holds throughout.)

**Worked example — `CuRuSuWu`:** direct search caps → by-quadrant → 4 sub-targets
`Cu------`,`--Ru----`,`----Su--`,`------Wu`; each a shallow base case search cracks in
~3 ops; assemble with 3 stacks. ~15 ops total — a guaranteed plan where search alone
finds nothing. by-half offers `CuRu----`+`----SuWu` as an alternative; cost-selection
keeps whichever is cheaper.

## Cost metric (the "intelligent" definition)

`solvePlan` returns `min(candidates, by = cost)`, so the cost function *is* the operational
definition of "intelligent".

**Chosen: reuse-credited op count, with shorter critical-path depth as tie-break.** The
plan is a DAG; a sub-plan used N times counts **once** (build `Cu------` once, fan it out).
This rewards the genuinely clever shared-sub-factory solution — e.g. `CuCuCuRu` builds the
Cu-quadrant once instead of three times.

**Acknowledged caveat (deferred to blueprint phase):** counting a shared piece "once"
ignores that in-game it'd need 2× throughput or a buffer. That is a *blueprint-tier*
concern; the plan expresses "this piece feeds two consumers" and the blueprint decides
duplicate-vs-belt-split. Consistent with intelligence-first / blueprint-later.

## Observability (first-class requirement)

For tuning, the frontend must show **which strategies fired**. The planner returns a
structured **strategy trace** alongside the solution path:

```
node = { target, method, statesExplored, opCount, children: [node…] }
        method ∈ direct-search | by-layer | by-quadrant | by-half
```

A compact summary is derived and rendered in the existing solver-stats area (the live
`onProgress` line + the final `Solved in… → N States` line at the bottom). Example:

```
Constructive | 12 ops | by-quadrant ×1 → 4 direct-searches | reused 0 | 1.2k states
```

The live `onProgress` line streams which sub-target is currently being attacked and via
what strategy. (Follow-up, not v1: color-tag flowchart nodes by the strategy that produced
them.)

## Scope

**v1 (Tier 1):** flat structural shapes — single- and multi-layer, the four shape types
(C/R/S/W) in any quadrant arrangement, **uncolored**. Nails `CuRuSuWu` and the entire
multi-distinct-quadrant class motivating #1677.

**Deferred to later tiers** (each independently shippable, each with a known recipe):
- **Color** — closest; a wrong color is one Painter op, so split ignoring color then paint.
  Held out of v1 to avoid paint-timing edge cases under covering layers.
- **Crystals, pins, floating/unsupported layers** — need special recipes (pin-push
  support, crystallize, careful stack order).

## Architecture & code placement

Two new sibling files (one-concept-per-file, ≤300 lines each) + three wiring edits.
**Dispatch happens at the worker level, not in core**, to avoid an import cycle (the
planner calls the search as a subroutine).

**New files:**
- **`shapeSolverDecompose.js`** — pure, stateless: `splitByLayer(shape)`,
  `splitByQuadrant(shape)`, `splitByHalf(shape)` → `{ pieces:[code…], assembly:[stack…] }`
  or `null`; plus `cost(plan)` (reuse-credited op count + depth tie-break). No imports
  beyond shape primitives → trivially unit-testable.
- **`shapeSolverConstructive.js`** — recursive orchestrator `solveConstructive(...)`.
  Imports core `shapeSolver` + the decompose module. Owns: per-node budget, memo table
  (sub-target→subplan), candidate generation, cost-selection, **path splicing**, and
  **strategy-trace** assembly.

**Wiring edits:**
- `shapeSolver.js` (worker): `if (searchMethod === 'Constructive') → solveConstructive(...)`
  else core `shapeSolver(...)`. Constructive imports core; core never imports Constructive
  → **no cycle**.
- `index.html`: add `<option value="Constructive">` to `#search-method-select`; update the
  option-desc.
- `main.js`: format `result.strategyTrace` into the stats line **and** add a `'Constructive'`
  branch to the option-group display toggle (the existing logic shows the heuristic-divisor
  group for `A*`/`IDA*`/`Bidirectional` and the max-states group for `BFS`; adding the new
  method to the `<select>` without updating this toggle silently hides both controls).
  Constructive wants the budget/max-states control shown and has no heuristic divisor.

**Result contract:** `solveConstructive` returns the same shape as the core search —
`{ solutionPath, depth, statesExplored, aborted }` — plus `strategyTrace`. `statesExplored`
aggregates across all base-case searches; `aborted` is set only if *no* decomposition
yields a fully-solved plan.

## Data flow & the main implementation risk: path splicing

Each base-case search returns a `solutionPath` *from the raw starting shapes*. The planner
merges sub-paths into **one** step list with **remapped shape IDs** (so IDs across
sub-plans don't collide), then appends the assembly `stack` steps. The existing path format
already encodes a DAG through input-ID references (it handles 2-input Stacker/Swapper), so:
- a **reused** piece naturally renders as one producer feeding multiple consumers (the
  belt-split / fan-out) — no format change needed;
- but the **ID remapping must be exact**, or the spliced path references a non-existent or
  wrong shape and the per-step correctness gate fails.

**ID invariant for the implementer:** each core `shapeSolver` call mints shape IDs
sequentially from 0 (it clears caches and reinitializes per call), so every sub-plan's ID
space overlaps. Before concatenating a sub-plan, offset all its IDs by
`max(existing IDs) + 1` (or thread a running counter through the splice). Reused (memoized)
sub-plans are spliced **once**; later consumers reference the already-offset output ID.

This is the highest-risk component and the focus of testing.

## Error handling

- **No applicable split / all candidates fail** → return `{ solutionPath: null,
  aborted: 'no-decomposition' }`; `main.js` shows a "couldn't decompose this target"
  message. (Should not happen for Tier-1 shapes — by-quadrant always applies — but
  out-of-scope inputs like crystals can land here.)
- **Cancellation** — the planner threads `shouldCancel` into every base-case search and
  checks it between candidates, returning `null` like the existing methods.
- **Base-case budget exhausted on a true primitive** (a single quadrant search can't solve
  within budget) → that candidate fails; if it was the only split, the parent fails upward.
  A genuine primitive failing indicates a bug, surfaced by tests.

## Testing

- **Per-step correctness gate (non-negotiable):** extend `tests/solve.mjs` with
  `--method Constructive`; it already validates every emitted step is a real operation
  start→target. These must now **solve and validate**: `CuRuSuWu`, `CuRu----`, `CuCuCuRu`
  (reuse), multi-layer `CuCuCuCu:RuRuRuRu`.
- **`tests/shapeSolverDecompose.test.js`:** golden assertions on the pure split functions
  + `cost()` — cheap, high-value unit layer.
- **`tests/constructive.test.js`:** solve `CuRuSuWu` → assert solved + valid path + op
  count in range; assert `CuCuCuRu`'s trace shows the Cu-quadrant built once (reuse
  credited).
- **Regression:** the four existing methods are untouched (Constructive is additive) —
  full `tests/smoke.js` + unit suites stay green. The cache-integrity guard already covers
  no-mutation, since assembly composes via the existing deep-copying ops.

## Deferred ideas (captured separately to Helm ideation)

- **M2 — pattern-DB / macro-guided single search (idea #3 promoted):** precompute
  exact build costs+recipes for primitive sub-shapes, feed as macro-operators / exact
  heuristic so one forward search becomes tractable. Composes with M1 (the memo table *is*
  a pattern DB). Sequenced after M1.
- **Color tier**, **crystal/pin/floating-layer tier** — Tier 2+.
- **Rotational-equivalence reuse** — build one `Cu` quadrant, rotate copies into 4
  positions (v1 memoizes by exact shape-code only).
- **Flowchart strategy-coloring** — tag graph nodes by producing strategy.
- **Auto-fallback** — run Constructive automatically when a chosen search caps (v1 is
  explicit method selection only).
