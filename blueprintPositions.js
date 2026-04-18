import { BUILDING_DATA } from './buildingData.js';
import { routeBelt } from './blueprintRouting.js';

/** Vertical distance between machine rows in tiles */
export const ROW_PITCH = 4;

/** Horizontal gap between machines within a row */
export const MACHINE_GAP = 1;

// ---------------------------------------------------------------------------
// 4) assignPositions — place machines and route belts on the tile grid
// ---------------------------------------------------------------------------

/**
 * Assign concrete (x, y) positions to machines and generate belt tiles
 * connecting them.
 *
 * Machine flow is top-to-bottom:
 *   - Inputs enter from the back (top / North side)
 *   - Outputs exit from the front (bottom / South side)
 *
 * @returns {BlueprintLayout}
 */
export function assignPositions(rows, solutionPath, topology) {
    const { nodes, edges, sources, producedBy } = topology;

    const machines = [];
    const belts = [];

    // Sort row keys numerically
    const rowKeys = Array.from(rows.keys()).sort((a, b) => a - b);

    // --- Phase A: place machines row by row ---

    // machinePos: stepIndex -> { x, y, width, def }
    const machinePos = new Map();

    // Track the x-column of each output port: stepIndex -> [{ x, shapeId, shapeCode }]
    const outputPorts = new Map();

    // Source entry belts: shapeId -> { x, y, shapeCode }
    const sourceEntries = new Map();

    // First, figure out how wide each row is to center everything later
    const rowWidths = new Map();
    for (const rowIdx of rowKeys) {
        const stepsInRow = rows.get(rowIdx);
        let width = 0;
        for (let i = 0; i < stepsInRow.length; i++) {
            const stepIdx = stepsInRow[i];
            const step = solutionPath[stepIdx];
            const def = BUILDING_DATA[step.operation];
            if (!def) continue; // shouldn't happen for non-Belt-Split steps
            const machineWidth = def.width || 1;
            width += machineWidth;
            if (i < stepsInRow.length - 1) width += MACHINE_GAP;
        }
        rowWidths.set(rowIdx, width);
    }

    // Also account for source entry columns needed above row 0
    // Collect all source shapes
    const allSourceIds = Array.from(sources.keys());

    // Determine total grid width: max of all row widths and source entries
    let maxRowWidth = 0;
    for (const w of rowWidths.values()) {
        if (w > maxRowWidth) maxRowWidth = w;
    }
    // Source entries: each gets one column, packed with 1-tile gaps
    const sourceWidth = allSourceIds.length > 0
        ? allSourceIds.length + (allSourceIds.length - 1) * MACHINE_GAP
        : 0;
    if (sourceWidth > maxRowWidth) maxRowWidth = sourceWidth;

    // Ensure minimum width
    if (maxRowWidth < 1) maxRowWidth = 1;

    // Place source entry points at the very top (y = 0)
    const sourceY = 0;
    let sourceX = Math.floor((maxRowWidth - sourceWidth) / 2);
    if (sourceX < 0) sourceX = 0;

    for (let i = 0; i < allSourceIds.length; i++) {
        const shapeId = allSourceIds[i];
        const shapeCode = sources.get(shapeId);
        const x = sourceX + i * (1 + MACHINE_GAP);
        sourceEntries.set(shapeId, { x, y: sourceY, shapeCode });

        // Place a source entry belt (flowing south into the factory)
        belts.push({
            x,
            y: sourceY,
            floor: 0,
            direction: 'S',
            kind: 'normal',
            shapeCode
        });
    }

    // Machine rows start after the source entries, with ROW_PITCH gap
    const firstMachineY = allSourceIds.length > 0 ? sourceY + ROW_PITCH : 0;

    for (const rowIdx of rowKeys) {
        const stepsInRow = rows.get(rowIdx);
        const y = firstMachineY + rowIdx * ROW_PITCH;

        // Calculate this row's total width for centering
        const rw = rowWidths.get(rowIdx) || 0;
        let curX = Math.floor((maxRowWidth - rw) / 2);
        if (curX < 0) curX = 0;

        for (const stepIdx of stepsInRow) {
            const step = solutionPath[stepIdx];
            const def = BUILDING_DATA[step.operation];
            if (!def) continue;

            const machineWidth = def.width || 1;
            const machineDepth = def.depth || 1;

            // Determine machine floor: use floorRestriction if set, otherwise floor 0
            const machineFloor = def.floorRestriction !== undefined ? def.floorRestriction : 0;

            machines.push({
                operation: step.operation,
                x: curX,
                y,
                floor: machineFloor,
                inputShapes: step.inputs.map(inp => inp.shape),
                outputShapes: step.outputs.map(out => out.shape),
                params: step.params || {},
                def
            });

            machinePos.set(stepIdx, { x: curX, y, width: machineWidth, depth: machineDepth, def, floor: machineFloor });

            // Record output ports (including floor from port definition)
            const ports = [];
            for (let oi = 0; oi < step.outputs.length; oi++) {
                const out = step.outputs[oi];
                const portDef = def.outputs[oi];
                const portOffset = portDef ? portDef.offset : oi;
                const portFloor = portDef?.floor ?? machineFloor;
                ports.push({
                    x: curX + portOffset,
                    y: y + machineDepth, // front face = bottom edge + depth
                    floor: portFloor,
                    shapeId: out.id,
                    shapeCode: out.shape
                });
            }
            outputPorts.set(stepIdx, ports);

            curX += machineWidth + MACHINE_GAP;
        }
    }

    // --- Phase B: route belts between output ports and input ports ---

    // Build a lookup: shapeId -> output port position (including floor)
    const outputPortLookup = new Map(); // shapeId -> { x, y, floor, shapeCode }
    for (const [stepIdx, ports] of outputPorts) {
        for (const port of ports) {
            outputPortLookup.set(port.shapeId, {
                x: port.x,
                y: port.y,
                floor: port.floor,
                shapeCode: port.shapeCode
            });
        }
    }

    // Also add source entries to the lookup (sources are always on floor 0)
    for (const [shapeId, entry] of sourceEntries) {
        outputPortLookup.set(shapeId, {
            x: entry.x,
            y: entry.y + 1, // belt exits from source tile going south
            floor: 0,
            shapeCode: entry.shapeCode
        });
    }

    // Belt Split handling: a Belt Split step's input shape ID maps to its
    // outputs.  We need to propagate the physical position of the upstream
    // output through Belt Splits so that each downstream consumer can find
    // its source position.
    //
    // For each Belt Split, we place a split belt at the upstream output
    // position and create virtual output entries for each of the split's
    // outputs.

    // Resolve Belt Split outputs
    for (let i = 0; i < solutionPath.length; i++) {
        const step = solutionPath[i];
        if (step.operation !== 'Belt Split') continue;

        const inputId = step.inputs[0].id;
        const upstreamPos = outputPortLookup.get(inputId);
        if (!upstreamPos) continue;

        // Place a split belt at the upstream position
        belts.push({
            x: upstreamPos.x,
            y: upstreamPos.y,
            floor: upstreamPos.floor,
            direction: 'S',
            kind: 'split',
            shapeCode: step.inputs[0].shape
        });

        // Each output of the Belt Split gets a virtual position
        // If multiple outputs, spread them horizontally
        for (let oi = 0; oi < step.outputs.length; oi++) {
            const out = step.outputs[oi];
            const offsetX = oi === 0 ? 0 : oi; // first output stays in-line
            outputPortLookup.set(out.id, {
                x: upstreamPos.x + offsetX,
                y: upstreamPos.y + 1,
                floor: upstreamPos.floor,
                shapeCode: out.shape
            });
        }
    }

    // Now route belts for each non-Belt-Split step's inputs
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

            // Determine the floor this input port is on
            const inputFloor = def.inputs[ii]?.floor ?? pos.floor;

            // Find where this shape comes from
            const src = outputPortLookup.get(inp.id);
            if (!src) continue;

            const srcFloor = src.floor ?? 0;

            // Route belt path from src to input port, handling floor transitions
            routeBelt(belts, src.x, src.y, srcFloor, inputX, inputY, inputFloor, inp.shape, def, ii);
        }
    }

    // --- Phase C: compute grid bounds ---

    let gridWidth = maxRowWidth;
    let gridHeight = 0;

    for (const m of machines) {
        const mDef = m.def;
        const right = m.x + (mDef.width || 1);
        const bottom = m.y + (mDef.depth || 1);
        if (right > gridWidth) gridWidth = right;
        if (bottom > gridHeight) gridHeight = bottom;
    }
    for (const b of belts) {
        if (b.x + 1 > gridWidth) gridWidth = b.x + 1;
        if (b.y + 1 > gridHeight) gridHeight = b.y + 1;
    }

    // Calculate actual floor count from placed entities
    const usedFloors = new Set();
    for (const m of machines) {
        usedFloors.add(m.floor);
        // Multi-floor machines span additional floors
        if (m.def.floors > 1) {
            for (let f = 0; f < m.def.floors; f++) usedFloors.add(m.floor + f);
        }
    }
    for (const b of belts) usedFloors.add(b.floor);
    const floorCount = usedFloors.size > 0 ? Math.max(...usedFloors) + 1 : 1;

    return {
        machines,
        belts,
        gridWidth,
        gridHeight,
        floorCount
    };
}
