# Constructive Decompose-and-Search Planner — Implementation Plan

**Goal:** Add a "Constructive" solver method that solves flat multi-distinct-quadrant targets (e.g. `CuRuSuWu`) by recursively decomposing the target into search-sized pieces, solving each piece with the existing search, and assembling them with `stack`.

**Architecture:** A recursive planner (`solveConstructive`) tries the existing bounded search first at every node (preserving clever shortcuts), and only when that caps does it split the target (by-quadrant / by-half / by-layer), recurse on the pieces, and pick the cheapest assembled plan by reuse-credited op count. Pure split logic lives in `shapeSolverDecompose.js`; the orchestrator in `shapeSolverConstructive.js` calls core `shapeSolver` as a subroutine — dispatched at the worker/harness level so core never imports the planner (no cycle).

**Tech Stack:** Vanilla JS ES modules, no build step. Reuses `shapeSolverCore.js` (search), `shapeOperations.js` (`stack`/`cut`), `shapeClass.js` (`Shape`), Cytoscape flowchart, plain `node tests/*.js` harness.

**Design doc:** `docs/plans/2026-06-11-recursive-decompose-search-design.md`

---

## Shared contracts (referenced by every task)

A **Step** (already the format produced by `shapeSolverCore.js`):
```js
{ operation: string,                 // OPERATIONS key, e.g. "Stacker", "Cutter", "Rotator CW"
  inputs:  [{ id: number, shape: string }],   // shape = shape-code string
  outputs: [{ id: number, shape: string }],
  params:  {} | { color: string } }
```

A **Plan** (internal to the constructive module):
```js
{ target: string,           // shape-code this plan produces (an acceptable rotation of the node target)
  method: 'direct-search' | 'by-layer' | 'by-quadrant' | 'by-half',
  steps: Step[],            // path producing `target`, ids local to this plan
  outputId: number,         // id of `target` within this plan's id space
  statesExplored: number,   // states used by the direct search at THIS node (0 for split nodes)
  children: Plan[] }        // sub-plans (empty for direct-search)
```

The solver result contract (what the worker/harness consume), unchanged plus one field:
```js
{ solutionPath: Step[] | null, depth: number | null, statesExplored: number,
  aborted: 'maxStates' | 'no-decomposition' | null,
  strategyTrace: TraceNode | null }     // NEW
TraceNode = { target, method, statesExplored, opCount, children: [TraceNode] }
```

Shape-code facts: 8 chars = 4 quadrants × 2 chars (`Cu`,`Ru`,`Su`,`Wu`, or `--` empty); positions left→right are quadrants 0–3; layers separated by `:` (bottom layer first). `stack(bottom, top)` gravity-merges via `_makeLayersFall`, so disjoint same-layer quadrant pieces merge into one layer.

---

### Task 1: Decomposition module (pure splits + cost) `[Mode: Direct]`

**Files:**
- Create: `shapeSolverDecompose.js`
- Test: `tests/shapeSolverDecompose.test.js`

**Contracts:**
```js
// All three take a shape-code, return piece shape-codes in fold order, or null if N/A.
// Pieces are folded by the orchestrator via left-fold stack: reduce((acc,p)=>stack(acc,p)).
splitByLayer(code: string): string[] | null     // null if single-layer; else layers BOTTOM→TOP
splitByQuadrant(code: string): string[] | null   // SINGLE-LAYER only; null if multi-layer or <2 occupied quadrants; else one positioned single-quadrant code per occupied quadrant
splitByHalf(code: string): string[] | null        // SINGLE-LAYER only; null if multi-layer or either half empty; else [leftHalf, rightHalf]

// Reuse-credited op count over a Plan tree, with critical-path depth as tie-break.
cost(plan: Plan): number   // = (distinct steps when flattened, memoized sub-plans counted once) + depth * 1e-6
```

**Test Cases:**
```js
// splitByLayer
assertEqual(splitByLayer('CuCuCuCu:RuRuRuRu'), ['CuCuCuCu', 'RuRuRuRu']);  // bottom first
assertEqual(splitByLayer('CuRuSuWu'), null);                                 // single layer

// splitByQuadrant — positioned single-quadrant pieces, occupied only
assertEqual(splitByQuadrant('CuRuSuWu'), ['Cu------', '--Ru----', '----Su--', '------Wu']);
assertEqual(splitByQuadrant('CuRu----'), ['Cu------', '--Ru----']);
assertEqual(splitByQuadrant('CuCuCuCu'), ['Cu------','--Cu----','----Cu--','------Cu']);
assertEqual(splitByQuadrant('CuCuCuCu:RuRuRuRu'), null);  // multi-layer
assertEqual(splitByQuadrant('Cu------'), null);            // <2 occupied quadrants (base case)

// splitByHalf
assertEqual(splitByHalf('CuRuSuWu'), ['CuRu----', '----SuWu']);
assertEqual(splitByHalf('Cu--Su--'), ['Cu------', '----Su--']);
assertEqual(splitByHalf('CuRu----'), ['CuRu----', null]??)  // right half empty -> whole thing returns null
assertEqual(splitByHalf('CuCuCuCu:Ru------'), null);  // multi-layer

// cost: reuse counted once. Build two Plan fixtures:
//   planA: 4 distinct single-quadrant children (no reuse) -> opCount = sum of child steps + 3 stacks
//   planB: a child Plan object referenced twice (memoized reuse) -> that child's steps counted ONCE
// assert cost(planB) < cost(planA_equivalent_without_reuse); assert depth tie-break orders equal-opCount plans by shorter critical path.
```

**Constraints:**
- Parse codes via `getCachedShape` (from `shapeClass.js`/cache) — **never mutate** the cached Shape; build new code strings. Guarded by `tests/shapeCacheIntegrity.test.js`.
- `splitByQuadrant`/`splitByHalf` reject multi-layer input (return null) — the orchestrator always tries `splitByLayer` for those.
- A "positioned single-quadrant code" keeps the quadrant in its original position (e.g. `Su` at quadrant 2 → `----Su--`), so the assembling `stack` gravity-merges into the correct slot with no rotation needed at assembly time.
- Resolve the `splitByHalf('CuRu----')` ambiguity above: if either half is all-empty, return `null` (a half-split into one empty piece is useless — by-quadrant covers it).

**Verification:** `node tests/shapeSolverDecompose.test.js` — exit 0, all asserts pass.

**Commit after passing.**

---

### Task 2: Constructive orchestrator (recursion, memo, cost-select, splice, trace) `[Mode: Delegated]`

**Files:**
- Create: `shapeSolverConstructive.js`
- Test: `tests/constructive.test.js`

**Contracts:**
```js
// Signature mirrors the relevant subset of core shapeSolver so the worker/harness can call either.
async function solveConstructive(
  targetShapeCode, startingShapeCodes, enabledOperations, maxLayers,
  preventWaste, orientationSensitive, monolayerPainting, heuristicDivisor,
  shouldCancel = () => false, onProgress = () => {},
  nodeBudget = 4000        // per-node maxStates for the base-case search
): Promise<{ solutionPath, depth, statesExplored, aborted, strategyTrace }>
```

Internal shape:
- `solvePlan(code) -> Plan | null`, memoized in a `Map<code, Plan|null>`:
  1. `coreSearch(code, nodeBudget)` via core `shapeSolver` with the **full** positional signature (do not abbreviate — `maxStatesPerLevel` is the 5th arg, distinct from the final `maxStates`):
     ```js
     await shapeSolver(
       code, startingShapeCodes, enabledOperations, maxLayers,
       Infinity,                              // maxStatesPerLevel (5th arg) — uncapped per-level
       preventWaste, orientationSensitive, monolayerPainting, heuristicDivisor,
       'A*', shouldCancel, onProgress,
       nodeBudget                             // maxStates (final arg) — the per-node budget
     );
     ```
     If `solutionPath` → `Plan{ method:'direct-search', steps, outputId, statesExplored, children:[] }`.
  2. Else for each applicable split in order `[splitByQuadrant, splitByHalf, splitByLayer]`: recurse `solvePlan` on every piece; if all non-null, build a candidate via `assemble(pieceePlans, splitMethod, code)`.
  3. Return `min(candidates, cost)` (or `null` if none). Memoize.
- `assemble(piecePlans, method, target) -> Plan`: produce a Plan whose `steps` are the spliced sub-plan steps + left-fold `stack` steps; `children = piecePlans`; `method = method`.
- Final: flatten the chosen root Plan into ONE `solutionPath` with a single global id space, then build `strategyTrace` from the Plan tree.

**Splice / id-remap rules (the high-risk core):**
- Each `coreSearch` mints ids from 0 (caches cleared per call), so every sub-plan's id space overlaps. When emitting a sub-plan's steps into the global path, offset all its ids (starts + intermediates) into a disjoint range via a running counter; rewrite `inputs[].id`/`outputs[].id` accordingly.
- A **memoized (reused) sub-plan is spliced exactly once**; later consumers reference its already-offset `outputId`. Track emitted Plans by object identity. This is what makes reuse "free" in the cost and renders as one producer → multiple consumers.
- Independent (non-identical) sub-plans each get their **own copies of the starting shapes** (distinct offset ids) — correct, since the factory pulls each start from its source per branch.
- Assembly `stack` steps: `operation:'Stacker'`, `inputs:[{id:accId,shape:accCode},{id:pieceOutId,shape:pieceCode}]`, `outputs:[{id:newId, shape: <stacked code>}]`, `params:{}`. Compute the output code with the concrete call `stack(accShape, pieceShape, new ShapeOperationConfig(maxLayers))[0]` (from `shapeOperations.js` / `shapeClass.js`) — pass the `ShapeOperationConfig(maxLayers)` so a non-default layer cap isn't silently wrong; `stack` returns a single-element array.

**Test Cases:**
```js
// End-to-end via the public function (no worker). validateStep re-runs each op like tests/solve.mjs.
test('CuRuSuWu solves and every step is a real op', async () => {
  const r = await solveConstructive('CuRuSuWu', DEFAULT_STARTS, ALL_OPS, 4, false,false,false,0.1);
  assert(r.solutionPath && isAcceptableRotation(lastOutput(r.solutionPath), 'CuRuSuWu'));
  assertEveryStepValid(r.solutionPath, DEFAULT_STARTS);   // reuse the solve.mjs validator
  assert(r.solutionPath.length <= 20);                    // sane op count (~15 expected)
});

test('strategyTrace reports the methods used', async () => {
  const r = await solveConstructive('CuRuSuWu', …);
  assert(r.strategyTrace.method === 'by-quadrant');
  assert(r.strategyTrace.children.every(c => c.method === 'direct-search'));
});

test('CuCuCuRu credits reuse — Cu-quadrant built once', async () => {
  const r = await solveConstructive('CuCuCuRu', …);
  assertEveryStepValid(r.solutionPath, DEFAULT_STARTS);
  // reuse-credit: total ops well below 4 independent quadrant builds; trace shows a shared child
  assert(r.solutionPath.length < /* naive 4×(cut-chain)+3 */ 15);
});

test('clever shortcut preserved — CuCuRuRu via direct search', async () => {
  const r = await solveConstructive('CuCuRuRu', …);
  assert(r.strategyTrace.method === 'direct-search');     // search found the 1-Swapper, no decomposition
  assert(r.solutionPath.length <= 2);
});

test('multi-layer CuCuCuCu:RuRuRuRu solves', async () => {
  const r = await solveConstructive('CuCuCuCu:RuRuRuRu', …);
  assertEveryStepValid(r.solutionPath, DEFAULT_STARTS);
});

test('cancellation returns null', async () => {
  const r = await solveConstructive('CuRuSuWu', …, /*shouldCancel*/ () => true);
  assert(r.solutionPath === null);
});
```

**Constraints:**
- Import core `shapeSolver` from `shapeSolverCore.js` and the splits/`cost` from `shapeSolverDecompose.js`. **Do not** add any import of this module to `shapeSolverCore.js` (no cycle).
- `onProgress` streams a line per node attacked, e.g. `Constructive | solving --Ru---- via direct-search | …`.
- `statesExplored` in the result = sum over all base-case searches. `aborted:'no-decomposition'` only when the root has no solving split (out-of-Tier-1 input like a crystal); never for Tier-1 shapes.
- Keep the file ≤300 lines; if splice/flatten grows large, extract a `shapeSolverConstructiveSplice.js` helper (update imports same commit).
- Must not mutate cached shapes (assembly uses `stack()` which deep-copies; ID rewrite operates on plain step objects).

**Verification:** `node tests/constructive.test.js` — exit 0.

**Commit after passing.**

---

### Task 3: Worker + headless-harness dispatch `[Mode: Direct]`

**Files:**
- Modify: `shapeSolver.js` (worker wrapper)
- Modify: `tests/solve.mjs` (node harness)

**Contracts / changes:**
- `shapeSolver.js`: in the `action==='solve'` branch, `if (searchMethod === 'Constructive')` call `solveConstructive(...)` (import it) with the matching args; else the existing core `shapeSolver(...)`. Post `{type:'result', result}` identically (now carrying `strategyTrace`).
- `tests/solve.mjs`: it imports and calls core `shapeSolver` directly (line ~117). Add: `if (opts.method === 'Constructive')` call `solveConstructive(...)` instead; update the `--method` help line (line 17) to list `Constructive`. The existing per-step validator (`stepReports`) then validates the spliced path unchanged.

**Constraints:**
- No behavior change for the four existing methods.
- Constructive uses a per-node `nodeBudget`, not the harness's 100k `maxStates`. Note that `opts.maxStates` in `solve.mjs` is **already defaulted to 100000** (line ~33), so you cannot distinguish "user passed --max-states" from "default" by reading `opts.maxStates`. Add a separate `--node-budget` flag (default 4000) for Constructive, or track explicit provision with a sentinel; do **not** feed the 100k default in as `nodeBudget` (it would defeat the fail-fast-then-decompose design).

**Verification:**
```
node tests/solve.mjs CuRuSuWu --method Constructive        # SOLVES, every step validated
node tests/solve.mjs CuRu---- --method Constructive        # SOLVES
node tests/solve.mjs 'CuCuCuCu:RuRuRuRu' --method Constructive   # SOLVES
node tests/solve.mjs CuCuRuRu --method Constructive        # SOLVES (direct-search shortcut)
```
Expected: each prints `target=… method=Constructive depth=… steps=…` and exits 0 (all steps valid).

**Commit after passing.**

---

### Task 4: Frontend wiring (dropdown, option-group toggle, trace stats) `[Mode: Direct]`

**Files:**
- Modify: `index.html`
- Modify: `main.js`

**Contracts / changes:**
- `index.html`: add `<option value="Constructive">Constructive</option>` to `#search-method-select` (after Bidirectional); extend the option-desc to mention Constructive ("decomposes hard multi-quadrant targets into search-sized pieces").
- `main.js`:
  1. **Option-group toggle** (the existing logic that shows the heuristic-divisor group for `A*`/`IDA*`/`Bidirectional` and the max-states group for `BFS`): add a `Constructive` branch — show the max-states/budget control, hide the heuristic-divisor group (Constructive has no divisor). Verify by switching the dropdown.
  2. **Stats line**: when `result.strategyTrace` is present, format and render a one-line summary in the existing solver-stats/status area, e.g.
     `Constructive | {opCount} ops | {byQuadrant×n → m direct-searches} | reused {k} | {states} states`.
     Derive counts by walking `strategyTrace`. Keep the existing `Solved in {t}s at Depth {d} → {n} States` line.

**Constraints:**
- Purely additive UI; the four existing methods render exactly as before.
- The strategy summary must be derivable from `strategyTrace` alone (no extra solver round-trips).

**Verification (functional, in browser via `helm-preview`):**
- Select **Constructive**, solve `CuRuSuWu` → flowchart renders a valid graph ending in the target; the stats line shows the Constructive summary with the right method counts.
- Switch back to A* → heuristic-divisor control reappears, stats line is the plain form.
- Run the full suite before commit: `node tests/smoke.js` + the new unit suites + existing `tests/*.test.js` all green.

**Commit after passing.**

---

## Execution
**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks (1, 3, 4): orchestrator implements directly
- Mode B task (2): dispatched to a subagent (the recursion + splice/id-remap is the creative core; everything else is well-determined)
- Task order is sequential: 1 → 2 → 3 → 4 (Task 2 depends on 1; Task 3 enables the end-to-end harness test of 2; Task 4 is the UI surface).
