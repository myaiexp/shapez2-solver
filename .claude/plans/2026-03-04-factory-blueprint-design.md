# Factory Blueprint Design

> Generate a 2D visual factory blueprint from solver output, showing game-accurate machine placement and belt routing per floor.

## Context

The solver currently outputs an operation flowchart (via Cytoscape.js) showing what operations in what order. Users must figure out machine placement and belt routing in-game themselves. This feature adds a spatial blueprint view that shows exactly where to place machines and how to connect them with belts.

## Architecture Overview

Three new modules consume the existing `solutionPath` data (unchanged) and produce a canvas-rendered factory layout:

```
solutionPath (from solver)
    │
    ▼
buildingData.js ──── Static building definitions (footprints, I/O, floors)
    │
    ▼
blueprintLayout.js ─ Topology extraction → Row-based placement → Belt routing
    │
    ▼
blueprintRenderer.js Canvas rendering with pan/zoom, floor switching, tooltips
```

The blueprint view lives in a new tab alongside the existing flowchart. Both consume the same solver output.

---

## 1. Building Data Model (`buildingData.js`, ~80 lines)

Single source-of-truth mapping operation names to physical properties. All values are best-guess defaults, trivially correctable when verified in-game.

```js
{
  "Cutter": {
    width: 2, depth: 1, floors: 1,
    inputs: [{ side: "back", offset: 0 }],
    outputs: [{ side: "front", offset: 0, label: "left" }, { side: "front", offset: 1, label: "right" }]
  },
  "Half Destroyer": {
    width: 1, depth: 1, floors: 1,
    inputs: [{ side: "back", offset: 0 }],
    outputs: [{ side: "front", offset: 0 }]
  },
  "Rotator CW":        { width: 1, depth: 1, floors: 1, inputs: [{ side: "back", offset: 0 }], outputs: [{ side: "front", offset: 0 }] },
  "Rotator CCW":       { width: 1, depth: 1, floors: 1, inputs: [{ side: "back", offset: 0 }], outputs: [{ side: "front", offset: 0 }] },
  "Rotator 180":       { width: 1, depth: 1, floors: 1, inputs: [{ side: "back", offset: 0 }], outputs: [{ side: "front", offset: 0 }] },
  "Stacker": {
    width: 2, depth: 1, floors: 2,
    inputs: [{ side: "back", offset: 0, floor: 0 }, { side: "back", offset: 0, floor: 1 }],
    outputs: [{ side: "front", offset: 0 }]
  },
  "Swapper": {
    width: 2, depth: 1, floors: 1,
    inputs: [{ side: "back", offset: 0 }, { side: "back", offset: 1 }],
    outputs: [{ side: "front", offset: 0 }, { side: "front", offset: 1 }]
  },
  "Painter": {
    width: 1, depth: 1, floors: 1,
    inputs: [{ side: "back", offset: 0 }],
    outputs: [{ side: "front", offset: 0 }],
    fluidInputs: [{ side: "left" }, { side: "right" }]
  },
  "Pin Pusher":         { width: 1, depth: 1, floors: 1, inputs: [{ side: "back", offset: 0 }], outputs: [{ side: "front", offset: 0 }] },
  "Crystal Generator":  { width: 1, depth: 1, floors: 1, inputs: [{ side: "back", offset: 0 }], outputs: [{ side: "front", offset: 0 }] },
  "Trash":              { width: 1, depth: 1, floors: 1, floorRestriction: 0, inputs: [{ side: "back", offset: 0 }], outputs: [] },
  "Belt Split":         null  // Belt mechanic, not a placed building
}
```

**Key properties:**
- `width`/`depth`: tile footprint
- `floors`: how many vertical floors the building spans
- `inputs`/`outputs`: I/O port positions relative to building facing direction. `side` = back/front/left/right, `offset` = tile offset along that side, `floor` = which floor (default 0)
- `fluidInputs`: for Painter — pipe connections on sides
- `floorRestriction`: if set, building can only be placed on this floor (Trash = ground floor only)
- `Belt Split` = null because it's a belt routing decision, not a building

---

## 2. Layout Algorithm (`blueprintLayout.js`, ~200 lines)

### Phase 1: Topology Extraction

Walk the `solutionPath` and build a directed graph:
- Each step with a building → machine node (type, orientation, floor)
- Belt Split steps → fork points in the connection graph (one belt in, multiple belts out)
- Starting shapes → source nodes (entry points at grid edge)
- Final target shape → sink node (exit point)

### Phase 2: Row-Based Placement

Factory layout follows a **row-based pipeline** pattern matching how players actually build in Shapez 2:

1. **Topological sort** into pipeline stages
2. **Group machines into rows** — machines receiving the same input form a row (e.g., 4 cutters all fed from one starting shape)
3. **Belt Split = distribute** — source belt arrives at a machine row, splits to feed every machine
4. **Belt Merge = collect** — outputs from all machines in a row merge onto a single belt
5. **Connect rows sequentially** — merged output from row N feeds the split for row N+1
6. **Orient machines** within each row side-by-side, all facing the same direction
7. **Belt routing is simple** — mostly straight runs between rows. Crossings handled by launchers/catchers or belt lifts (obstacles are minimal in Shapez 2)

### Floor Assignment (Deferred)

For MVP: place everything on floor 0. Multi-floor machine placement is a future iteration. The data model supports it (floor property on I/O ports, `floors` on buildings), but the placement algorithm treats everything as single-floor for now.

---

## 3. Canvas Renderer (`blueprintRenderer.js`, ~250 lines)

### Tile Rendering
- Fixed tile size (e.g., 32px), zoomable via mouse wheel
- Tile types: empty, machine (with type icon + orientation arrow), belt (with direction), belt split/merge point, launcher/catcher pair, belt lift
- Machines spanning multiple tiles (Cutter = 2x1) occupy full footprint
- Color-coded by machine type

### Floor Navigation
- Floor indicator showing current floor number
- Up/Down buttons to switch between floors
- Each floor = separate data layer, rendered independently
- Belt lifts shown as special tiles on both source and destination floors

### Interactivity
- Pan by dragging, zoom with scroll wheel
- Hover tile → tooltip (machine type, shape code being processed, operation details)
- Click machine → highlight its input/output belt path

### Export
- Copy-to-clipboard as PNG (matching existing flowchart export)

---

## 4. UI Integration

### Tab System
- New toggle in the graph area: **Flowchart | Blueprint**
- Flowchart tab = existing Cytoscape graph (unchanged)
- Blueprint tab = new canvas + floor controls
- Both consume the same `solutionPath`

### Changes to Existing Files

| File | Change |
|------|--------|
| `index.html` | Add tab toggle, canvas container, floor controls |
| `styles.css` | Tab styling, canvas container, floor control styling |
| `main.js` | Wire tab switching, trigger blueprint generation after solve |

**No changes** to solver, shape operations, or existing graph rendering.

---

## 5. Deferred Decisions

- **Multi-floor machine placement** — some machines can/must use specific floors. Data model supports it; placement algorithm ignores it for MVP.
- **Platform/notch constraints** — platform sizing and notch-based entry/exit points. Not needed for internal layout.
- **Throughput optimization** — building-per-belt ratios for determining how many machines per row. Future enhancement.

---

## Game Mechanics Reference

See `docs/shapez-2-reference.md` for detailed building footprints, belt mechanics, floor system, and platform constraints.

Key facts for the layout algorithm:
- Belt Split is a belt mechanic, not a building. Used to distribute one belt to a row of machines.
- Resources don't dry up — always deliver full belt from initial shapes to factories.
- Belt crossings are trivial (launcher/catcher or belt lift over obstacles).
- Trash is ground-floor only.
- Stacker spans 2 floors (bottom input floor 0, top input floor 1).
