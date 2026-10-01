import { BUILDING_DATA } from './buildingData.js';
import { routeBelt } from './blueprintRouting.js';
import { computeGridBounds } from './blueprintBounds.js';

/** Vertical distance between machine rows in tiles */
export const ROW_PITCH = 4;

/** Horizontal gap between machines within a row */
export const MACHINE_GAP = 1;

// ---------------------------------------------------------------------------
// Phase A: place source entries and machine rows on the tile grid
// ---------------------------------------------------------------------------

/**
 * Resolve each step in a row to its building definition. Rows hold only
 * non-Belt-Split steps, and every solver operation has a BUILDING_DATA entry
 * (pinned by buildingDataCoverage.test.js), so the skip is defensive.
 */
function rowEntries(stepsInRow, solutionPath) {
    const entries = [];
    for (const stepIdx of stepsInRow) {
        const step = solutionPath[stepIdx];
        const def = BUILDING_DATA[step.operation];
        if (def) entries.push({ stepIdx, step, def });
    }
    return entries;
}

/** Tile width of a row: machine widths plus a MACHINE_GAP between neighbours. */
function rowWidth(entries) {
    if (entries.length === 0) return 0;
    let width = (entries.length - 1) * MACHINE_GAP;
    for (const { def } of entries) width += def.width || 1;
    return width;
}

/**
 * Place one south-flowing entry belt per source shape at y = 0, centered on
 * the grid, one column each with MACHINE_GAP between them.
 *
 * @returns {Map} shapeId -> { x, y, shapeCode }
 */
function placeSources(sources, gridWidth, sourceWidth, belts) {
    const sourceEntries = new Map();
    const startX = Math.max(0, Math.floor((gridWidth - sourceWidth) / 2));
    let i = 0;
    for (const [shapeId, shapeCode] of sources) {
        const x = startX + i * (1 + MACHINE_GAP);
        sourceEntries.set(shapeId, { x, y: 0, shapeCode });
        belts.push({ x, y: 0, floor: 0, direction: 'S', kind: 'normal', shapeCode });
        i++;
    }
    return sourceEntries;
}

/**
 * Place one row of machines left to right, centered on the grid. Records each
 * machine's position and its output ports (front face, port-defined floor).
 */
function placeRow(entries, y, gridWidth, placed) {
    let curX = Math.max(0, Math.floor((gridWidth - rowWidth(entries)) / 2));

    for (const { stepIdx, step, def } of entries) {
        const width = def.width || 1;
        const depth = def.depth || 1;
        const floor = def.floorRestriction ?? 0;

        placed.machines.push({
            operation: step.operation,
            x: curX,
            y,
            floor,
            inputShapes: step.inputs.map(inp => inp.shape),
            outputShapes: step.outputs.map(out => out.shape),
            params: step.params || {},
            def
        });
        placed.machinePos.set(stepIdx, { x: curX, y, width, depth, def, floor });

        placed.outputPortsByStep.set(stepIdx, step.outputs.map((out, oi) => {
            const portDef = def.outputs[oi];
            return {
                x: curX + (portDef ? portDef.offset : oi),
                y: y + depth, // front face
                floor: portDef?.floor ?? floor,
                shapeId: out.id,
                shapeCode: out.shape
            };
        }));

        curX += width + MACHINE_GAP;
    }
}

/**
 * Place source-entry belts and machine rows, recording the positions and
 * output ports that later phases route belts between.
 *
 * Machine flow is top-to-bottom:
 *   - Inputs enter from the back (top / North side)
 *   - Outputs exit from the front (bottom / South side)
 *
 * @returns {{
 *   machines: Array, belts: Array,
 *   machinePos: Map, outputPortsByStep: Map, sourceEntries: Map,
 *   maxRowWidth: number
 * }} machinePos: stepIdx -> { x, y, width, depth, def, floor };
 *    outputPortsByStep: stepIdx -> [{ x, y, floor, shapeId, shapeCode }];
 *    sourceEntries: shapeId -> { x, y, shapeCode }.
 */
function placeMachines(rows, solutionPath, sources) {
    const rowKeys = Array.from(rows.keys()).sort((a, b) => a - b);
    const entriesByRow = new Map(rowKeys.map(r => [r, rowEntries(rows.get(r), solutionPath)]));

    const sourceWidth = sources.size > 0 ? sources.size + (sources.size - 1) * MACHINE_GAP : 0;
    let maxRowWidth = Math.max(1, sourceWidth);
    for (const entries of entriesByRow.values()) {
        maxRowWidth = Math.max(maxRowWidth, rowWidth(entries));
    }

    const belts = [];
    const sourceEntries = placeSources(sources, maxRowWidth, sourceWidth, belts);

    // Machine rows start ROW_PITCH below the source entries, if there are any
    const firstMachineY = sources.size > 0 ? ROW_PITCH : 0;
    const placed = { machines: [], machinePos: new Map(), outputPortsByStep: new Map() };
    for (const rowIdx of rowKeys) {
        placeRow(entriesByRow.get(rowIdx), firstMachineY + rowIdx * ROW_PITCH, maxRowWidth, placed);
    }

    return { ...placed, belts, sourceEntries, maxRowWidth };
}

// ---------------------------------------------------------------------------
// Phase B: map each shape to where it is produced, propagate Belt Splits, route belts
// ---------------------------------------------------------------------------

/**
 * Build a lookup from shapeId to the tile its belt starts from: a machine
 * output port, or the exit tile below a source entry. propagateBeltSplits
 * later adds virtual positions for Belt Split outputs.
 *
 * @returns {Map} shapeId -> { x, y, floor, shapeCode }
 */
function buildProducerLookup(outputPortsByStep, sourceEntries) {
    const producerPosByShapeId = new Map();
    for (const ports of outputPortsByStep.values()) {
        for (const port of ports) {
            producerPosByShapeId.set(port.shapeId, {
                x: port.x,
                y: port.y,
                floor: port.floor,
                shapeCode: port.shapeCode
            });
        }
    }

    // Sources are always on floor 0; their belt exits the source tile going south
    for (const [shapeId, entry] of sourceEntries) {
        producerPosByShapeId.set(shapeId, {
            x: entry.x,
            y: entry.y + 1,
            floor: 0,
            shapeCode: entry.shapeCode
        });
    }

    return producerPosByShapeId;
}

/**
 * Propagate upstream output positions through Belt Split steps. For each split
 * we place a split belt at the upstream output position and register a virtual
 * output position for every split output, so downstream consumers can find
 * their source. Mutates `producerPosByShapeId` and appends to `belts`.
 */
function propagateBeltSplits(solutionPath, producerPosByShapeId, belts) {
    for (let i = 0; i < solutionPath.length; i++) {
        const step = solutionPath[i];
        if (step.operation !== 'Belt Split') continue;

        const inputId = step.inputs[0].id;
        const upstreamPos = producerPosByShapeId.get(inputId);
        if (!upstreamPos) continue;

        belts.push({
            x: upstreamPos.x,
            y: upstreamPos.y,
            floor: upstreamPos.floor,
            direction: 'S',
            kind: 'split',
            shapeCode: step.inputs[0].shape
        });

        // Split outputs fan out one column apart, one tile below the split
        for (let oi = 0; oi < step.outputs.length; oi++) {
            const out = step.outputs[oi];
            producerPosByShapeId.set(out.id, {
                x: upstreamPos.x + oi,
                y: upstreamPos.y + 1,
                floor: upstreamPos.floor,
                shapeCode: out.shape
            });
        }
    }
}

/**
 * Route belts from each non-Belt-Split machine's input ports back to the
 * tiles that produce their shapes, handling floor transitions via routeBelt.
 * Appends routed belt tiles to `belts`.
 */
function routeAllBelts(solutionPath, nodes, machinePos, producerPosByShapeId, belts) {
    const placeableSteps = new Set();
    for (const [idx, node] of nodes) {
        if (!node.isBeltSplit) placeableSteps.add(idx);
    }

    for (const stepIdx of placeableSteps) {
        const step = solutionPath[stepIdx];
        const pos = machinePos.get(stepIdx);
        if (!pos) continue;
        const def = pos.def;

        for (let ii = 0; ii < step.inputs.length; ii++) {
            const inp = step.inputs[ii];
            // For multi-input machines with same offset on different floors (e.g. Stacker),
            // spread inputs across columns to avoid overlapping belts in 2D layout.
            let inputOffset = def.inputs[ii] ? def.inputs[ii].offset : ii;
            if (ii > 0 && def.inputs[ii] && def.inputs[ii - 1] &&
                def.inputs[ii].offset === def.inputs[ii - 1].offset) {
                inputOffset = ii; // Use sequential offset instead
            }
            const inputX = pos.x + inputOffset;
            const inputY = pos.y; // back face = top of machine
            const inputFloor = def.inputs[ii]?.floor ?? pos.floor;

            const src = producerPosByShapeId.get(inp.id);
            if (!src) continue;

            routeBelt(belts, src.x, src.y, src.floor ?? 0, inputX, inputY, inputFloor, inp.shape, def, ii);
        }
    }
}

// ---------------------------------------------------------------------------
// Phase C: derive grid floor count from placed entities
// ---------------------------------------------------------------------------

/** Count the floors actually occupied by machines (incl. multi-floor spans) and belts. */
function computeFloorCount(machines, belts) {
    const usedFloors = new Set();
    for (const m of machines) {
        usedFloors.add(m.floor);
        // Multi-floor machines span additional floors
        if (m.def.floors > 1) {
            for (let f = 0; f < m.def.floors; f++) usedFloors.add(m.floor + f);
        }
    }
    for (const b of belts) usedFloors.add(b.floor);
    return usedFloors.size > 0 ? Math.max(...usedFloors) + 1 : 1;
}

// ---------------------------------------------------------------------------
// assignPositions — orchestrate machine placement and belt routing
// ---------------------------------------------------------------------------

/**
 * Assign concrete (x, y) positions to machines and generate belt tiles
 * connecting them.
 *
 * @returns {BlueprintLayout}
 */
export function assignPositions(rows, solutionPath, topology) {
    const { nodes, sources } = topology;

    // Phase A: place source entries and machine rows
    const { machines, belts, machinePos, outputPortsByStep, sourceEntries, maxRowWidth } =
        placeMachines(rows, solutionPath, sources);

    // Phase B: map each shape to the tile that produces it, propagate Belt
    // Splits, then route belts from each consumer's inputs back to those tiles
    const producerPosByShapeId = buildProducerLookup(outputPortsByStep, sourceEntries);
    propagateBeltSplits(solutionPath, producerPosByShapeId, belts);
    routeAllBelts(solutionPath, nodes, machinePos, producerPosByShapeId, belts);

    // Phase C: compute grid bounds and floor count
    const { gridWidth, gridHeight } = computeGridBounds(machines, belts, maxRowWidth);
    const floorCount = computeFloorCount(machines, belts);

    return {
        machines,
        belts,
        gridWidth,
        gridHeight,
        floorCount
    };
}
