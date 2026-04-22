# Persistent Solver State

## Problem

The solver UI loses everything on page refresh. Configuration (target, starting shapes, enabled operations, all options) and the most recent solution (flowchart graph + blueprint layout) are reconstructed from defaults on every load.

This is especially bad for the solution itself: the solver is non-deterministic in the sense that the same inputs can produce different valid solutions across runs (and across solver code changes). A user who built a factory in-game from a specific solution loses that exact solution on refresh and may not be able to reproduce it.

## Goal

After a refresh, the user sees the page exactly as they left it: same configuration, same rendered flowchart, same blueprint layout, same view tab, same scroll/floor state. They do not need to re-run the solver to get back to where they were.

State persists across browser restarts (localStorage, not sessionStorage).

## Non-Goals

- **Space-explorer output is not persisted.** Different render path (`renderSpaceGraph`) and explore runs are inherently more ephemeral. Filed as a deferred idea.
- **No explicit "Clear" button.** YAGNI. Users can clear via devtools if needed; we can add a UI button later if real friction emerges.
- **No multi-slot save / named solutions.** One slot, always overwriting. If the user wants alternates, that's a future feature.
- **No cross-device sync.** localStorage is per-browser, per-origin.
- **No schema migration.** A `version` field invalidates old state on schema change rather than migrating it.

## Architecture

One new module — `persistence.js` — with four functions:

- `loadState()` — reads + parses localStorage; returns a state object or `null` on missing/invalid data.
- `saveState(state)` — serializes + writes to localStorage; swallows quota errors.
- `captureState()` — reads the current DOM/state into a state object (used by all save triggers).
- `applyState(state, deps)` — writes a state object back into the DOM and re-renders the solution. `deps` carries the renderer hooks (`renderGraph`, `buildLayout`, `duplicateForThroughput`, `BlueprintRenderer`, blueprint layout setter).

`main.js` wires it up:
- On `DOMContentLoaded`, after `initializeDefaultShapes()`: try to load + apply state; on any error, clear storage and continue with defaults.
- Mutation handlers (input changes, list edits, operation toggles, tab switches, solve completion, view controls) call `saveState(captureState())` after their existing logic.

No other module changes.

## Data Schema

Storage key: `shapez2-solver-state-v1`. Single JSON blob:

```js
{
  version: 1,
  inputs: {
    target: string,                  // #target-shape value
    depthLimit: string,              // #depth-limit-input value (kept as string, can be empty)
    startingShapes: string[],        // shape codes from #starting-shapes list, in DOM order
    enabledOperations: string[],     // data-operation values from .operation-item.enabled
    searchMethod: string,            // #search-method-select value
    maxStatesPerLevel: string,       // numeric inputs kept as string for round-trip
    heuristicDivisor: string,
    preventWaste: boolean,
    orientationSensitive: boolean,
    monolayerPainting: boolean,
    filterUnusedShapes: boolean,
    throughputMultiplier: string,
    maxLayers: string,
    colorMode: string,               // 'rgb' | 'ryb' | 'cmyk'
  },
  solution: null | {
    solutionPath: object[],          // raw array from solver result
    depth: number,
    statesExplored: number,
    solveTimeSec: string,            // raw `(elapsedMs/1000).toFixed(2)` value, e.g. "3.14" — no "s" suffix
  },
  view: {
    activeSidebarTab: 'shapes' | 'options',
    activeOutputView: 'flowchart' | 'blueprint',
    graphDirection: string,          // #direction-select value
    edgeStyle: string,               // #edge-style-select value
    blueprintFloor: number,          // 0-based
  }
}
```

**Why store `solutionPath` and not the layout:** the layout is recomputable via `buildLayout(solutionPath)` + `duplicateForThroughput(layout, multiplier)`. Storing only `solutionPath` keeps the blob smaller and avoids breakage if the layout schema ever changes — old solutions still re-layout cleanly. The Cytoscape graph is rebuilt the same way (`renderGraph(solutionPath)`).

**Why strings for numeric inputs:** mirrors what the form actually holds. Avoids `null`/`NaN` round-trip issues when an input is empty.

## Save Triggers

Every mutation that changes any persisted field calls `saveState(captureState())`. Specifically:

- `change` event on every form input listed in `inputs` (target, depth limit, search method, max states, heuristic divisor, all four checkboxes, throughput multiplier, max layers, color mode)
- Starting-shapes list mutations: add (`#add-shape-btn`), remove (delegated handler), extract (modal confirm)
- Operation toggle clicks (existing handler on `.operation-item`)
- Sidebar tab switch (existing `.tab-button` handler)
- Output view switch (existing `.view-tab-button` handler)
- Solve completion (success or "no solution" path) — saves with `solution` populated or `null`
- Graph direction change (`#direction-select`)
- Edge style change (`#edge-style-select`)
- Floor change (`#floor-up-btn` / `#floor-down-btn`)

No debouncing. The blob is small (~few KB even with a deep solution path) and writes are synchronous-fast.

**What we do NOT save on:** running a solve (`solving` state is transient — only the result matters), space-explorer runs (output not persisted at all), cancel actions.

## Load + Apply Flow

On `DOMContentLoaded`, after `initializeDefaultShapes()`:

```
state = loadState()
if state == null: return  // no saved state, defaults stand
try:
  applyState(state, deps)
catch err:
  console.warn('Failed to restore state, clearing.', err)
  localStorage.removeItem('shapez2-solver-state-v1')
```

`applyState` steps, in order:

1. Set every form input value from `state.inputs.*`.
2. Replace `#starting-shapes` contents: clear the default 4 shapes, append `createShapeItem(code)` for each saved code.
3. For each `.operation-item`, toggle `.enabled` based on whether its `data-operation` is in `state.inputs.enabledOperations`.
4. Dispatch `change` on `#search-method-select` so the heuristic-divisor / max-states groups show/hide correctly.
5. Restore active sidebar tab: replicate the existing handler — sidebar buttons map id `foo-tab-btn` → content id `foo-content` (`btn.id.replace('-tab-btn', '-content')`).
6. Restore active output view: replicate the existing handler — view buttons map id `foo-tab-btn` → element id `foo` (`btn.id.replace('-tab-btn', '')`). If the restored view is `blueprint`, instantiate `blueprintRenderer` matching the existing tab-switch logic.
7. If `state.solution` exists:
   - `renderGraph(state.solution.solutionPath)` — rebuilds Cytoscape graph.
   - `applyGraphLayout(state.view.graphDirection)` to honor saved direction.
   - Compute `currentBlueprintLayout = buildLayout(solutionPath)`; apply throughput multiplier from `state.inputs.throughputMultiplier`.
   - If blueprint view active, call `blueprintRenderer.setLayout(currentBlueprintLayout)`, then `setFloor(state.view.blueprintFloor)` and update `#floor-indicator`.
   - Restore status text: `Solved in {solveTimeSec}s at Depth {depth} → {statesExplored} States` (same format as live).

If `state.solution == null` and the user previously saw "No solution found.", restore that status text too. If neither, status stays `Idle`.

## Error Handling

- **Parse failure** (corrupted JSON): caught at `loadState`, returns `null`, defaults apply.
- **Schema mismatch** (`version != 1` or missing required fields): treated as parse failure, returns `null`.
- **Apply failure** (renderer throws on `solutionPath` from a different code version): top-level `try/catch` around `applyState`; on error, clear storage and reload defaults via a fresh init pass. We do NOT attempt partial restore (e.g. "inputs worked but solution didn't") — too many edge cases for a v1.
- **Quota exceeded on save**: `saveState` catches and logs to console. State just stops persisting until next page load — non-fatal.

## Testing

- **Smoke test** (`tests/smoke.js`): focus on `captureState` ↔ `loadState` JSON round-trip — build a state object, stringify, parse, assert deep equality. `applyState` is not tested in the smoke harness because it depends on real DOM and live renderer modules (`renderGraph`, `BlueprintRenderer`); stubbing those reliably is more work than the test is worth. `applyState` is covered by manual verification below.
- **Manual verification** before commit:
  1. Set custom target + non-default options + edited starting shapes; refresh; confirm everything restored.
  2. Run a solve; refresh; confirm flowchart and blueprint render identically without re-solving.
  3. Switch to blueprint view, change floor; refresh; confirm same view + floor.
  4. Manually corrupt localStorage value (`localStorage.setItem('shapez2-solver-state-v1', 'garbage')`); refresh; confirm defaults load without errors in console (a warning is fine).
