# Factory Blueprint Implementation Plan

**Goal:** Add a canvas-based 2D factory blueprint view that converts solver output into a spatial layout showing machine placement and belt routing, displayed in a new tab alongside the existing flowchart.

**Architecture:** Three new modules (`buildingData.js`, `blueprintLayout.js`, `blueprintRenderer.js`) consume the existing `solutionPath` unchanged. The layout algorithm groups machines into pipeline rows matching how players build in Shapez 2 (split → row of machines → merge → next row). A canvas renderer draws the tile grid with pan/zoom/hover. A tab toggle in the graph area switches between flowchart and blueprint views.

**Tech Stack:** Vanilla JS (ES modules), HTML5 Canvas API, no new dependencies.

---

## Task 1: Building Data [Mode: Direct]

**Files:**
- Create: `buildingData.js`

**Contracts:**
```js
/**
 * @typedef {Object} IOPort
 * @property {'back'|'front'|'left'|'right'} side
 * @property {number} offset
 * @property {number} [floor]
 * @property {string} [label]
 */

/**
 * @typedef {Object} BuildingDef
 * @property {number} width
 * @property {number} depth
 * @property {number} floors
 * @property {IOPort[]} inputs
 * @property {IOPort[]} outputs
 * @property {IOPort[]} [fluidInputs]
 * @property {number} [floorRestriction]
 */

export const BUILDING_DATA = { ... }; // keyed by operation name, "Belt Split" → null
```

All 12 operation names from the solver must be present as keys. Values per the design doc.

**Verification:** `import('./buildingData.js').then(m => console.log(Object.keys(m.BUILDING_DATA)))` — 12 keys, "Belt Split" is null, "Cutter" has width 2.

**Commit:** `feat: add building data definitions`

---

## Task 2: Blueprint Layout Algorithm [Mode: Delegated]

**Files:**
- Create: `blueprintLayout.js`

**Contracts:**
```js
import { BUILDING_DATA } from './buildingData.js';

/**
 * @typedef {Object} PlacedMachine
 * @property {string} operation
 * @property {number} x              - grid column (top-left)
 * @property {number} y              - grid row (top-left)
 * @property {number} floor          - always 0 in MVP
 * @property {string[]} inputShapes  - shape codes flowing in
 * @property {string[]} outputShapes - shape codes flowing out
 * @property {Object} params         - forwarded from solutionPath (e.g. {color})
 * @property {BuildingDef} def       - from BUILDING_DATA
 */

/**
 * @typedef {Object} PlacedBelt
 * @property {number} x
 * @property {number} y
 * @property {number} floor
 * @property {'N'|'S'|'E'|'W'} direction
 * @property {'normal'|'split'|'merge'} kind
 * @property {string} [shapeCode]
 */

/**
 * @typedef {Object} BlueprintLayout
 * @property {PlacedMachine[]} machines
 * @property {PlacedBelt[]} belts
 * @property {number} gridWidth
 * @property {number} gridHeight
 * @property {number} floorCount
 */

export function buildLayout(solutionPath) → BlueprintLayout
```

**Internal structure (4 private functions):**

1. `extractTopology(solutionPath)` — Build dependency graph. Nodes = step indices. Edges = "output shape ID from step A is input shape ID to step B". Belt Split steps are pass-through forks.

2. `topoSort(topology)` — Kahn's algorithm. Returns ordered step indices from source to sink.

3. `groupIntoRows(sortedSteps, topology, solutionPath)` — Steps fed by the same source form a row. Belt Split steps excluded from rows (they annotate edges). Diamond patterns (two chains → Stacker) create a merge row.

4. `assignPositions(rows, solutionPath)` — Row N at `y = N * ROW_PITCH` (ROW_PITCH = 4). Machines packed left-to-right with 1-tile gaps. Belt tiles connect row outputs to row+1 inputs. Belt splits placed before machine rows, belt merges after.

**Key edge cases:**
- Cutter has 2 outputs → 2 separate belt columns from its front face
- Belt Split duplicates same shape ID to multiple outputs — topology must track this correctly
- Diamond dependency (two chains → Stacker) → merge row, not part of either upstream chain
- Source shapes = belt entry points at top-left of grid

**Verification:** Console: `buildLayout(solutionPath)` returns machines array with correct operation names, positive gridWidth/gridHeight, no machines overlapping.

**Commit:** `feat: add blueprint layout algorithm`

---

## Task 3: Blueprint Canvas Renderer [Mode: Delegated]

**Files:**
- Create: `blueprintRenderer.js`

**Contracts:**
```js
export class BlueprintRenderer {
    constructor(canvas: HTMLCanvasElement)
    setLayout(layout: BlueprintLayout): void
    setFloor(floorIndex: number): void
    exportPng(): Promise<Blob>
    destroy(): void

    // Readonly state
    currentFloor: number
}
```

**Rendering responsibilities:**
- Tile grid background (faint lines at TILE_SIZE intervals)
- Machines as colored rectangles spanning `def.width × def.depth` tiles, with operation label
- Belts as directional arrows (▲▼◄►) in belt color
- Belt split/merge tiles with distinct visual (fork/join icon)
- Canvas backed at `devicePixelRatio` for sharp rendering
- Color map per machine type (defined as module constant, easy to tune)

**Interactivity:**
- Scroll → zoom (centered on cursor)
- Drag → pan
- Hover → tooltip (machine type, shape codes, params)
- `cursor: grab` / `cursor: grabbing` via CSS

**Floor switching:**
- `setFloor(n)` filters machines/belts to only those on floor n, then re-renders
- No-op if n is out of range (0 to layout.floorCount - 1)

**Export:**
- `exportPng()` renders full layout (not just visible viewport) to an offscreen canvas, returns blob

**Verification:** After Task 5 wiring — solve a shape, switch to Blueprint tab. Canvas shows colored machine rectangles with belt connections. Scroll zooms, drag pans, hover shows tooltip.

**Commit:** `feat: add blueprint canvas renderer`

---

## Task 4: HTML + CSS Tab UI [Mode: Direct]

**Files:**
- Modify: `index.html` (lines 156-187)
- Modify: `styles.css`

**HTML changes — new structure for `#main`:**
```html
<div id="main">
    <div id="view-tab-container">
        <button class="view-tab-button active" id="flowchart-view-tab-btn">Flowchart</button>
        <button class="view-tab-button" id="blueprint-view-tab-btn">Blueprint</button>
    </div>
    <div id="flowchart-view" class="view-tab-content active">
        <!-- existing #graph-wrapper moved inside here -->
    </div>
    <div id="blueprint-view" class="view-tab-content">
        <canvas id="blueprint-canvas"></canvas>
        <div id="blueprint-floor-controls">
            <button id="floor-up-btn">&#9650;</button>
            <span id="floor-indicator">Floor 0</span>
            <button id="floor-down-btn">&#9660;</button>
        </div>
    </div>
    <!-- existing .graph-controls stays here (always visible) -->
</div>
```

**CSS changes:**
- `#view-tab-container` — flex row, border-bottom, bg-sidebar
- `.view-tab-button` / `.view-tab-button.active` — match existing `.tab-button` visual style
- `.view-tab-content` — `display: none`, `.active` → `display: flex; flex: 1`
- `#blueprint-canvas` — `width: 100%; height: 100%; cursor: grab`
- `#blueprint-floor-controls` — absolute positioned bottom-right overlay
- Change `#graph-container` height from `calc(100vh - 60px)` to `100%` (now sized by flex parent)

**Verification:** Open page. Two tabs visible. Clicking Blueprint hides flowchart, shows canvas area with floor controls. Clicking Flowchart restores graph. Existing graph rendering still works.

**Commit:** `feat: add blueprint tab and canvas container UI`

---

## Task 5: Main.js Wiring [Mode: Direct]

**Files:**
- Modify: `main.js`

**Changes:**

1. **Imports:** Add `buildLayout` from `blueprintLayout.js`, `BlueprintRenderer` from `blueprintRenderer.js`

2. **State:** `let blueprintRenderer = null; let currentBlueprintLayout = null;`

3. **View tab switching:** Follow existing sidebar tab pattern. On switch to blueprint → init renderer, set layout. On switch away → destroy renderer.

4. **After solve** (line ~227, after `renderGraph`): `currentBlueprintLayout = buildLayout(result.solutionPath)`. If renderer active, call `setLayout`.

5. **Floor controls:** Wire `#floor-up-btn` / `#floor-down-btn` to `blueprintRenderer.setFloor()`, update `#floor-indicator` text.

6. **Snapshot button:** Make context-aware — if blueprint view is active and renderer exists, call `blueprintRenderer.exportPng()`. Otherwise fall through to existing `copyGraphToClipboard()`.

**Verification:** Full end-to-end test:
- Solve any shape → flowchart renders as before
- Switch to Blueprint tab → factory layout renders
- Zoom/pan/hover works
- Solve a different shape → blueprint updates
- Snapshot from blueprint tab → copies PNG
- Snapshot from flowchart tab → existing behavior
- Floor buttons update display (even though MVP only has floor 0)

**Commit:** `feat: wire blueprint rendering into main app`

---

## Execution Order

```
Task 1 (buildingData)     ─── no deps ─────────┐
Task 4 (HTML + CSS)       ─── no deps ─────────┤
Task 2 (layout algorithm) ─── needs Task 1 ────┤
Task 3 (canvas renderer)  ─── needs Task 2 ────┤
Task 5 (main.js wiring)   ─── needs all ───────┘
```

Tasks 1 and 4 are independent and can run in parallel. Tasks 2 and 3 are sequential (3 needs 2's types). Task 5 connects everything.

---

## Execution
**Skill:** superpowers:subagent-driven-development
- Mode A tasks: Opus implements directly (Tasks 1, 4, 5)
- Mode B tasks: Dispatched to subagents (Tasks 2, 3)
