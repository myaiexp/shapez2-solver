# Persistent Solver State

> **Historical — test paths have moved.** Tests now live under `tests/{shape,solver,blueprint,shared}/`: smoke is `node tests/shared/smoke.js`; current commands are in [testing.md](../testing.md).
>
> Updated 2026-09-14 to match the shipped `persistence.js`: Reset Saved State / `clearState()`, `captureState(runtime)`, `isValidSolutionPath`, `applyState`'s corrupt-list and tab guards, and their tests — `tests/shared/persistence.test.js` (storage) and `tests/shared/persistenceApply.test.js` (`captureState`/`applyState` against a fake document). The original "no Clear button" non-goal is superseded.

## Problem

The solver UI loses everything on page refresh. Configuration (target, starting shapes, enabled operations, all options) and the most recent solution (flowchart graph + blueprint layout) are reconstructed from defaults on every load.

This is especially bad for the solution itself: the solver is non-deterministic in the sense that the same inputs can produce different valid solutions across runs (and across solver code changes). A user who built a factory in-game from a specific solution loses that exact solution on refresh and may not be able to reproduce it.

## Goal

After a refresh, the user sees the page exactly as they left it: same configuration, same rendered flowchart, same blueprint layout, same view tab, same scroll/floor state. They do not need to re-run the solver to get back to where they were.

State persists across browser restarts (localStorage, not sessionStorage).

## Non-Goals

- **Space-explorer output is not persisted.** Different render path (`renderSpaceGraph`) and explore runs are inherently more ephemeral. Filed as a deferred idea.
- ~~**No explicit "Clear" button.**~~ Superseded (commit 26669b5): Options → **Reset Saved State** (`#reset-state-btn`) confirms, calls `clearState()`, and reloads into defaults.
- **No multi-slot save / named solutions.** One slot, always overwriting. If the user wants alternates, that's a future feature.
- **No cross-device sync.** localStorage is per-browser, per-origin.
- **No schema migration.** A `version` field invalidates old state on schema change rather than migrating it.

## Architecture

One module — `persistence.js` — exporting:

- `loadState()` — reads + parses localStorage; returns a state object or `null` on missing/invalid data (unparseable JSON, wrong `version`, missing `inputs`/`view`).
- `saveState(state)` — serializes + writes to localStorage; swallows quota errors.
- `clearState()` — removes the storage key; returns `true` iff the removal succeeded (storage errors are swallowed and return `false`). Used by Reset Saved State and the restore-failure path.
- `captureState(runtime)` — reads the current DOM into a state object. `runtime` supplies what the DOM cannot: `currentSolution` (main.js's `lastSolution`) and `currentBlueprintFloor`.
- `applyState(state, deps)` — writes a state object back into the DOM and re-renders the solution, returning `{ restoredSolution, restoredFloor }` so main.js can adopt the solution and set up the blueprint renderer. `deps` carries `renderGraph`, `applyGraphLayout`, `buildLayout`, `duplicateForThroughput`, `BlueprintRenderer`, `createShapeItem`, and a `setBlueprintLayout` setter.
- `isValidSolutionPath(path)` — structural check (non-empty operation name, input/output endpoints with a string shape and an id, `params.color` on colored ops) that `applyState` runs before a saved `solutionPath` reaches the renderers.
- `STORAGE_KEY`, `SCHEMA_VERSION` — the key and version constants.

`main.js` wires it up:
- On `DOMContentLoaded`, after `initializeDefaultShapes()`: load + apply state with saving suspended; on any error, `clearState()` and reload into defaults.
- Mutation handlers (input changes, list edits, operation toggles, tab switches, solve completion, view controls) call `persist()` — `saveState(captureState({ currentSolution, currentBlueprintFloor }))` — after their existing logic.
- `#reset-state-btn` confirms, calls `clearState()`, and reloads.

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
  if clearState(): location.reload()   // skipped if storage itself throws, or the reload would loop
```

`applyState` steps, in order:

1. Set every form input value from `state.inputs.*`.
2. Replace `#starting-shapes` contents with `createShapeItem(code)` for each saved code — only when `startingShapes` is an array (non-string entries dropped; an explicit `[]` clears). An absent or non-array list leaves the page defaults, like an absent form field.
3. For each `.operation-item`, toggle `.enabled` by membership in `enabledOperations`, under the same array-only rule.
4. Dispatch `change` on `#search-method-select` so the heuristic-divisor / max-states groups show/hide correctly.
5. Restore active sidebar tab: button `<tab>-tab-btn`, panel `<tab>-content`.
6. Restore active output view: button `<view>-view-tab-btn`, panel `<view>-view`. Either group switches only when both its button and panel exist, so a stale or corrupt tab name leaves the current tab active instead of blanking the pane.
7. If `state.solution` exists **and** `isValidSolutionPath(state.solution.solutionPath)`:
   - `renderGraph(state.solution.solutionPath)` — rebuilds Cytoscape graph.
   - `applyGraphLayout(state.view.graphDirection)` to honor saved direction.
   - `setBlueprintLayout(buildLayout(solutionPath))`, with the throughput multiplier from `state.inputs.throughputMultiplier` applied.
   - Restore status text: `Solved in {solveTimeSec}s at Depth {depth} → {statesExplored} States` (same format as live).

Back in main.js, using `applyState`'s return value: adopt `state.solution` as `lastSolution` only if `restoredSolution`, and if the blueprint view is active, create the `BlueprintRenderer`, `setLayout`, then `setFloor(restoredFloor)` and update `#floor-indicator`.

With no valid saved solution, status stays `Idle` (a saved "No solution found." is not restored).

## Error Handling

- **Parse failure** (corrupted JSON): caught at `loadState`, returns `null`, defaults apply.
- **Schema mismatch** (`version != 1` or missing required fields): treated as parse failure, returns `null`.
- **Structurally corrupt solution** (versioned blob, malformed `solutionPath`): `isValidSolutionPath` rejects it and `applyState` skips the solution while still restoring inputs and view.
- **Apply failure** (renderer throws on `solutionPath` from a different code version): top-level `try/catch` around `applyState`; on error, `clearState()` and reload into defaults. We do NOT attempt partial restore (e.g. "inputs worked but solution didn't") — too many edge cases for a v1.
- **Quota exceeded on save**: `saveState` catches and logs to console. State just stops persisting until next page load — non-fatal.

## Testing

- **Unit tests** (`tests/shared/persistence.test.js`): `loadState` / `saveState` / `clearState` against an in-memory localStorage stub — round trip, nothing stored, corrupt JSON, throwing storage backends, and `clearState`'s return value — plus `isValidSolutionPath` accept/reject cases. `tests/shared/smoke.js` also runs every solver-produced path through `isValidSolutionPath`, so a path a reload would discard fails the suite.
- **DOM tests** (`tests/shared/persistenceApply.test.js`): `captureState`/`applyState` against a fake `document` mirroring `index.html` and fake renderer deps — round trip, field restore, the solution gate, throughput duplication, corrupt lists and tab names. Real rendering is covered only by the manual verification below.
- **Manual verification** before commit:
  1. Set custom target + non-default options + edited starting shapes; refresh; confirm everything restored.
  2. Run a solve; refresh; confirm flowchart and blueprint render identically without re-solving.
  3. Switch to blueprint view, change floor; refresh; confirm same view + floor.
  4. Manually corrupt localStorage value (`localStorage.setItem('shapez2-solver-state-v1', 'garbage')`); refresh; confirm defaults load without errors in console (a warning is fine).
  5. Click Options → Reset Saved State, confirm; the page reloads with defaults and the storage key is gone.
