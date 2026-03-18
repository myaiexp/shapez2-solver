# Solver Optimization Plan

Analysis of performance bottlenecks and algorithmic improvements for the shape solver.

---

## Performance Bottlenecks

### 1. Redundant Shape Parsing

`Shape.fromShapeCode()` is called on every shape, in every state, on every dequeue. The heuristic alone parses every available shape + all their rotations per state evaluation. The same shape code like `"CuCuCuCu"` can be parsed tens of thousands of times.

**Fix:** Shape cache — a `Map<string, Shape>` keyed by shape code. Operations already produce shape codes via `toShapeCode()`, so each unique shape would only be parsed once.

**Where:** `shapeSolver.js` — add a module-level cache, replace all `Shape.fromShapeCode()` calls with a cached lookup.

### 2. Expensive Heuristic Computation

`getHeuristic()` does heavy work per call:
- Parses every shape in the state from code
- Calls `_getSimilarity()` per shape (iterates all parts 3 times + generates all rotations)
- For non-orientation-sensitive mode, generates 4 rotations and computes similarity for each

Called once per state explored. A* explores thousands of states.

**Fix:** Cache similarity-to-target by shape code. The target never changes, so `_getSimilarity(shapeCode, target)` only needs computing once per unique shape code. Store in a `Map<string, number>`.

**Where:** `shapeSolver.js` — `getHeuristic()` function, add a `similarityCache` Map.

### 3. Expensive State Key Generation

`getStateKey()` builds a count map, sorts entries, and JSON-serializes — for every successor state. With 12 operations × N available shapes, that's a lot of `JSON.stringify()`.

**Fix:** Sort shape codes directly and join with a delimiter instead of building a count map + JSON. Or use a numeric hash.

**Where:** `shapeSolver.js` — `getStateKey()`.

### 4. Unbounded Memory Growth

The `shapes` Map and `costSoFar`/`cameFrom` Maps grow without bound. Every operation output gets a new unique ID stored forever. For complex targets this can consume hundreds of MB.

**Fix:** Consider IDA* (see algorithmic section) or periodic pruning of states that are clearly worse than the current best.

### 5. BFS Path Copying

BFS creates `[...path, step]` per successor — O(depth) copy × O(branching_factor^depth) states = massive memory. A* avoids this with `cameFrom`, but BFS doesn't.

**Fix:** Use parent pointers (like A* does) instead of copying full paths. Reconstruct path only when solution is found.

---

## Algorithmic Improvements

### 6. Backward Search / Bidirectional (highest algorithmic impact)

Currently search only goes forward: "what can I build from these shapes?" This has a huge branching factor because every operation on every shape is tried.

**Backward search** starts from the target and asks "what could have produced this?" — then meets the forward search in the middle.

Why it's effective:
- Decomposing the target has fewer options (e.g., this shape was clearly stacked from two halves, or painted)
- The backward branching factor is much smaller
- Bidirectional search reduces state space from O(b^d) to O(2 × b^(d/2))

Example: target `CrCrCrCr` with starting shape `CuCuCuCu` — backward search immediately identifies "this is a painted circle → undo paint → `CuCuCuCu` → starting shape." One step.

**Invertible operations:**
- Paint → unpaint (known: target tells you what color was applied)
- Rotate CW → Rotate CCW (and vice versa)
- Stack → Cut (decompose into bottom + top)
- Cut → Stack (reconstruct from halves)
- Pin Push → remove bottom pin layer

**Implementation:** Run forward BFS/A* and backward BFS simultaneously. When a shape code appears in both frontiers, connect the paths.

### 7. Better Domain-Specific Heuristic

The current heuristic uses generic similarity scoring. Game-specific knowledge gives tighter lower bounds:

- **Layer gap:** `max(0, target.layers - maxAvailableLayers)` stacks needed — already implemented
- **Color mismatches:** count positions where shape type matches but color differs → at least `ceil(N/partsPerLayer)` paint operations (painter paints entire top layer)
- **Structural mismatches:** count quarter-positions where the shape type is wrong → each cut/rotate/stack fixes limited positions
- **Missing shape types:** if target needs a Star and no available shape has one, at least 1 cut needed

A tighter heuristic means A* expands far fewer states before finding the solution.

### 8. Symmetry Canonicalization

When `orientationSensitive` is false, states that differ only by rotation of shapes are equivalent. Currently the solver explores all of them separately.

**Fix:** Canonicalize each shape to its lexicographically smallest rotation before storing. Pick `min(shape, rotateCW(shape), rotate180(shape), rotateCCW(shape))` by shape code string comparison.

Reduces effective state space by up to 4x.

**Where:** Add a `canonicalize(shapeCode)` function, apply it whenever storing a shape code in the state.

### 9. Operation Pruning (No-Op Detection)

Many state transitions are provably useless:
- Rotating a symmetric shape (e.g., `CuCuCuCu` is unchanged by any rotation)
- Cutting a shape with one half already empty
- Painting a shape that's already the right color
- Trashing your only shape
- Rotating after rotating (combine into a single rotation)
- Cutting immediately after stacking the same pieces

Filter these before generating successor states.

**Where:** `shapeSolver.js` — inside the operation loop, add pre-checks per operation type.

### 10. Operation Result Caching

`cut("CuCuCuCu")` always produces the same outputs regardless of when it's called. Many search branches will attempt the same operation on the same shape.

**Fix:** Cache `Map<string, Shape[]>` keyed by `opName + ":" + shapeCode(s)`.

**Where:** `shapeSolver.js` — wrap operation calls in a cache lookup.

### 11. IDA* for Deep Searches

IDA* (Iterative Deepening A*) finds optimal solutions like A* but uses O(depth) memory instead of O(states). The current A* can blow up memory on hard targets. IDA* enables solving targets that currently fail.

Tradeoff: IDA* re-explores states on each iteration, so it's slower per-state than A*. But for searches where A* runs out of memory, IDA* is the only option that stays optimal.

**Where:** Add as a third search method option alongside BFS and A*.

---

## Priority Order

| # | Improvement | Type | Expected Impact | Difficulty |
|---|------------|------|----------------|------------|
| 1 | Shape cache (parse once) | Performance | 5-20x faster | Easy |
| 2 | Similarity-to-target cache | Performance | 3-10x faster | Easy |
| 3 | Backward search / bidirectional | Algorithm | 10-100x for complex targets | Hard |
| 4 | Symmetry canonicalization | Pruning | 2-4x fewer states | Medium |
| 5 | Operation pruning (no-ops) | Pruning | 2-5x fewer states | Medium |
| 6 | Better domain-specific heuristic | Algorithm | 3-10x fewer states | Medium |
| 7 | Operation result caching | Performance | 2-3x faster | Easy |
| 8 | IDA* for deep searches | Algorithm | Enables previously unsolvable | Medium |
| 9 | Faster state keys | Performance | 1.5-2x faster | Easy |
| 10 | BFS parent pointers | Performance | Memory reduction | Easy |

Items 1-2 are quick wins — no algorithm changes, just caching. Item 3 is the biggest algorithmic leap. Items 4-6 are medium effort with strong payoff. Items 7-10 are incremental.

---

## Files to Modify

- **`shapeSolver.js`** — All changes. Core search loop, heuristic, state management.
- **`shapeOperations.js`** — Possibly add `canonicalize()` for symmetry reduction. Operation functions themselves don't need changes.
- **`main.js`** — Add IDA* to search method dropdown if implemented.
- **`index.html`** — UI for new search method option.
