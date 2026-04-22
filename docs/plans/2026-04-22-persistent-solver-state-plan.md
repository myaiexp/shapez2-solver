# Persistent Solver State Implementation Plan

**Goal:** Persist solver inputs, the most recent solution, and view state to localStorage so a page refresh restores the user's exact prior state.

**Architecture:** One new module (`persistence.js`) with four pure-ish functions: `loadState`, `saveState`, `captureState`, `applyState`. `main.js` calls `applyState` once on init, and `saveState(captureState())` after every state-changing event (input changes, list mutations, operation toggles, tab switches, solve completion, view controls). The blueprint layout is recomputed from the saved `solutionPath` rather than serialized directly.

**Tech Stack:** Vanilla ES modules, browser `localStorage`, no new dependencies.

**Spec:** `docs/plans/2026-04-22-persistent-solver-state-design.md` (read this first — it contains the full schema and apply-flow contract).

---

## File Structure

- **Create**: `persistence.js` — all persistence logic. Exports `loadState`, `saveState`, `captureState`, `applyState`.
- **Modify**: `main.js` — import + wire persistence. Add init-time load + save calls inside existing event handlers. No restructuring of existing handlers; persistence calls go at the end of each handler so existing logic is unaffected.
- **Modify**: `tests/smoke.js` — add a single round-trip case asserting that a representative state object survives `JSON.parse(JSON.stringify(state))` with deep equality. This is a tripwire for accidentally introducing non-serializable data into the schema.

`persistence.js` will be roughly 150–250 lines — well under the 300-line limit.

---

## Task 1: Implement persistence + integration [Mode: Direct]

**Files:**
- Create: `/home/mase/Projects/solvers/shapez2-solver/persistence.js`
- Modify: `/home/mase/Projects/solvers/shapez2-solver/main.js`
- Modify: `/home/mase/Projects/solvers/shapez2-solver/tests/smoke.js`

**Contracts:**

```js
// persistence.js

export const STORAGE_KEY = 'shapez2-solver-state-v1';
export const SCHEMA_VERSION = 1;

/**
 * Read + parse persisted state.
 * @returns {object|null} state object on success; null on missing, parse failure, or schema mismatch.
 */
export function loadState();

/**
 * Serialize + write state to localStorage. Swallows quota errors (logs to console).
 * @param {object} state
 */
export function saveState(state);

/**
 * Snapshot current DOM/runtime state into a state object matching the schema.
 * @param {object} runtime - { currentSolution, currentBlueprintFloor }
 *   currentSolution: null | { solutionPath, depth, statesExplored, solveTimeSec }
 *   currentBlueprintFloor: number
 * @returns {object} state object ready to pass to saveState.
 */
export function captureState(runtime);

/**
 * Apply a loaded state object to the DOM and re-render the solution.
 * Throws on any apply failure — callers should catch and clear storage.
 * @param {object} state
 * @param {object} deps - { renderGraph, applyGraphLayout, buildLayout, duplicateForThroughput, BlueprintRenderer, createShapeItem, setBlueprintLayout }
 *   setBlueprintLayout: (layout) => void  // setter for main.js's currentBlueprintLayout
 * @returns {object} { restoredSolution: bool, restoredFloor: number }
 *   Caller uses this to update its own runtime state (e.g. assign currentBlueprintLayout, set blueprintRenderer floor).
 */
export function applyState(state, deps);
```

**Schema:** Exactly as defined in the design doc. The `version` field MUST equal `SCHEMA_VERSION` or `loadState` returns `null`.

**captureState reads from DOM:**
- All form inputs by id (string values for text/number, `.checked` for checkboxes, `.value` for selects)
- Starting shapes: `Array.from(document.querySelectorAll('#starting-shapes .shape-item .shape-label')).map(el => el.textContent)`
- Enabled operations: `Array.from(document.querySelectorAll('#enabled-operations .operation-item.enabled')).map(el => el.dataset.operation)`
- Active sidebar tab: find `.tab-button.active` → `btn.id.replace('-tab-btn', '')` (`shapes-tab-btn` → `'shapes'`, `options-tab-btn` → `'options'`)
- Active output view: find `.view-tab-button.active` → `btn.id.replace('-view-tab-btn', '')` (`flowchart-view-tab-btn` → `'flowchart'`, `blueprint-view-tab-btn` → `'blueprint'`). Note this differs from the apply-side transform — apply uses `replace('-tab-btn', '')` to derive the DOM element id (`'flowchart-view'` / `'blueprint-view'`), capture strips `-view-tab-btn` to get the schema value.

**applyState writes to DOM in this order** (matches design doc Apply Flow):
1. Set every form input value from `state.inputs`
2. Clear `#starting-shapes`, append `deps.createShapeItem(code)` for each saved code
3. For each `.operation-item`, toggle `.enabled` based on whether `data-operation` is in `state.inputs.enabledOperations`
4. Dispatch `change` event on `#search-method-select` (so dependent UI updates)
5. Restore active sidebar tab: replicate the existing handler — sidebar buttons map id `foo-tab-btn` → content id `foo-content` (`btn.id.replace('-tab-btn', '-content')`)
6. Restore active output view: replicate the existing handler — view buttons map id `foo-tab-btn` → element id `foo` (`btn.id.replace('-tab-btn', '')`)
7. If `state.solution`:
   - `deps.renderGraph(state.solution.solutionPath)`
   - `deps.applyGraphLayout(state.view.graphDirection)`
   - Compute `layout = deps.buildLayout(solutionPath)`; if `parseInt(state.inputs.throughputMultiplier) > 1`, `layout = deps.duplicateForThroughput(layout, multiplier)`
   - `deps.setBlueprintLayout(layout)` (lets main.js assign to its `currentBlueprintLayout`)
   - Restore status text: `byId('status').textContent = \`Solved in ${state.solution.solveTimeSec}s at Depth ${state.solution.depth} → ${state.solution.statesExplored} States\``
   - If output view is `'blueprint'`, the existing tab handler already instantiated `blueprintRenderer` in step 6 — return `restoredFloor` so main.js can call `blueprintRenderer.setLayout(layout)` and `setFloor(state.view.blueprintFloor)` after applyState returns.
8. If `state.solution === null` and a previously-saved status existed, status stays `Idle` (don't restore "No solution found." — too brittle). YAGNI.

**main.js integration:**

Import:
```js
import { loadState, saveState, captureState, applyState, STORAGE_KEY } from './persistence.js';
```

Add a small helper (in `main.js`, not in `persistence.js`):
```js
let lastSolution = null;  // { solutionPath, depth, statesExplored, solveTimeSec } | null
function persist() {
    saveState(captureState({
        currentSolution: lastSolution,
        currentBlueprintFloor: blueprintRenderer?.currentFloor ?? 0,
    }));
}
```

**Where to call `persist()`:**
- End of `#add-shape-btn` click handler
- End of `#starting-shapes` click handler when a remove happened
- End of `#extract-confirm` click handler (success branch only)
- End of `.tab-button` click handler (each)
- End of `.view-tab-button` click handler (each)
- End of `.operation-item` click handler
- New `change` listener on each persisted form input (target, depth-limit, search-method, max-states, heuristic-divisor, all four checkboxes, throughput-multiplier, max-layers, color-mode)
- End of `#direction-select` change handler
- End of `#edge-style-select` change handler
- End of `#floor-up-btn` / `#floor-down-btn` handlers
- Inside `solverWorker.onmessage` result handler: assign `lastSolution = result.solutionPath ? { solutionPath: result.solutionPath, depth: result.depth, statesExplored: result.statesExplored, solveTimeSec: t } : null` then call `persist()`. (`t` is the existing `((performance.now() - startTime) / 1000).toFixed(2)` value — hoist into a variable.)

**Init wiring** (inside the existing `DOMContentLoaded` handler in `main.js`, after `initializeDefaultShapes()`):
```js
const state = loadState();
if (state) {
    try {
        const { restoredSolution, restoredFloor } = applyState(state, {
            renderGraph,
            applyGraphLayout,
            buildLayout,
            duplicateForThroughput,
            BlueprintRenderer,
            createShapeItem,
            setBlueprintLayout: (layout) => { currentBlueprintLayout = layout; },
        });
        // Re-hydrate lastSolution so subsequent saves preserve it
        if (restoredSolution) lastSolution = state.solution;
        // Hydrate blueprintRenderer if blueprint view is active
        if (state.view.activeOutputView === 'blueprint' && currentBlueprintLayout) {
            if (!blueprintRenderer) {
                blueprintRenderer = new BlueprintRenderer(byId('blueprint-canvas'));
            }
            blueprintRenderer.setLayout(currentBlueprintLayout);
            if (restoredFloor > 0 && restoredFloor < currentBlueprintLayout.floorCount) {
                blueprintRenderer.setFloor(restoredFloor);
                byId('floor-indicator').textContent = `Floor ${restoredFloor}`;
            }
        }
    } catch (err) {
        console.warn('Failed to restore solver state, clearing.', err);
        localStorage.removeItem(STORAGE_KEY);
    }
}
```

Note: `currentBlueprintLayout` and `blueprintRenderer` are existing module-level `let` bindings in `main.js` — they're already mutated by other handlers, so the closure pattern above works.

**Constraints:**
- No new dependencies.
- `persistence.js` does not import from `main.js` — all coupling flows via the `deps` parameter passed to `applyState`. This keeps `persistence.js` testable in isolation and avoids a circular import.
- No debouncing on save calls — the JSON blob is small (a few KB even with a deep solution path), `localStorage.setItem` is fast, and mutation events are user-paced.
- If an existing handler is short-circuited by a `return` (e.g. `add-shape-btn` returning on empty input), `persist()` is NOT called — only call `persist()` on the success paths.
- **Suspend `persist()` during `applyState`.** `applyState` dispatches `change` on `#search-method-select` (step 4) which would re-fire `persist` before the view tab restoration in steps 5–6 completes — capturing a half-restored state and overwriting the saved view. Use a module-level `suspendPersist` flag set true around the `applyState` call; `persist()` checks the flag and no-ops while suspended.
- Public repo: do not embed any path or identity in comments. Match existing style.

**Test Cases:**

For `tests/smoke.js`, add this block at the bottom (before the final `console.log`):

```js
// Persistence: schema round-trips through JSON without loss.
{
    const key = 'Persistence: schema round-trip';
    total++;
    const state = {
        version: 1,
        inputs: {
            target: 'CuRuSuWu:CuCuCuCu',
            depthLimit: '10',
            startingShapes: ['CuCuCuCu', 'RuRuRuRu'],
            enabledOperations: ['cut', 'stack', 'paint'],
            searchMethod: 'A*',
            maxStatesPerLevel: '7500',
            heuristicDivisor: '0.1',
            preventWaste: true,
            orientationSensitive: false,
            monolayerPainting: false,
            filterUnusedShapes: true,
            throughputMultiplier: '2',
            maxLayers: '4',
            colorMode: 'rgb',
        },
        solution: {
            solutionPath: [{ op: 'cut', inputs: ['CuCuCuCu'], outputs: [{ shape: 'Cu------' }], params: {} }],
            depth: 1,
            statesExplored: 42,
            solveTimeSec: '0.05',
        },
        view: {
            activeSidebarTab: 'options',
            activeOutputView: 'blueprint',
            graphDirection: 'TB',
            edgeStyle: 'curved',
            blueprintFloor: 0,
        },
    };
    const roundTripped = JSON.parse(JSON.stringify(state));
    const match = JSON.stringify(roundTripped) === JSON.stringify(state);
    if (match) {
        console.log(`\u2713 ${key}`);
        passed++;
    } else {
        console.log(`\u2717 ${key} \u2014 round-trip mismatch`);
        failed = true;
    }
}
```

Manual verification (perform after smoke test passes):

1. **Inputs survive refresh.** Load page; change target shape, toggle two non-default operations, edit max-layers to `5`, switch sidebar to Options tab. Refresh. Expected: all values restored, Options tab active, color mode correct.
2. **Solution survives refresh.** Set target to a moderately complex shape, click Solve, wait for result. Refresh. Expected: flowchart graph reappears identical (same node positions ± Cytoscape layout determinism), status text restored to `Solved in Xs at Depth Y → Z States`, switching to Blueprint shows the same layout.
3. **Blueprint view + floor survive refresh.** After step 2, switch to Blueprint view, click floor controls if multi-floor available. Refresh. Expected: Blueprint view active, same floor displayed.
4. **Corrupted storage is handled.** In devtools console: `localStorage.setItem('shapez2-solver-state-v1', '{not json'); location.reload();`. Expected: page loads with defaults, single `console.warn` line, no broken UI. After reload, `localStorage.getItem('shapez2-solver-state-v1')` should be either cleared or replaced by a fresh valid state from the first mutation.
5. **Schema-mismatch storage is handled.** In devtools console: `localStorage.setItem('shapez2-solver-state-v1', JSON.stringify({ version: 99 })); location.reload();`. Expected: defaults load silently (no warning, since `loadState` returned `null` cleanly).
6. **Empty starting-shapes survive.** Remove all default starting shapes. Refresh. Expected: starting-shapes list is empty (NOT repopulated with defaults). This verifies that the saved-state branch fully overrides `initializeDefaultShapes`.

**Verification:**
Run: `node tests/smoke.js`
Expected: All cases pass, including new `Persistence: schema round-trip`.

Then perform manual verification steps 1–6 above in browser at http://localhost:8765 (existing caxi session).

**Commit after passing.**

---

## Execution

**Skill:** Subagent Dev (if included in your instructions)
- Mode A tasks: Opus implements directly
- Mode B tasks: Dispatched to subagents

This plan has one task, Mode A. Opus implements directly.
