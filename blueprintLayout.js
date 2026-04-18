import { extractTopology, topoSort, groupIntoRows } from './blueprintTopology.js';
import { assignPositions, MACHINE_GAP } from './blueprintPositions.js';

/**
 * @typedef {Object} PlacedMachine
 * @property {string} operation
 * @property {number} x              - grid column (top-left)
 * @property {number} y              - grid row (top-left)
 * @property {number} floor          - floor index (0 = ground)
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
 * @property {'normal'|'split'|'merge'|'lift'} kind
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a solver solutionPath into a spatial factory layout.
 *
 * @param {Object[]} solutionPath - Array of step objects from the solver.
 *   Each step has: { operation, inputs: [{id, shape}], outputs: [{id, shape}], params }
 *
 * @returns {BlueprintLayout} Layout with placed machines and belt tiles.
 */
export function buildLayout(solutionPath) {
    if (!solutionPath || solutionPath.length === 0) {
        return {
            machines: [],
            belts: [],
            gridWidth: 0,
            gridHeight: 0,
            floorCount: 1
        };
    }

    // Step 1: build dependency graph
    const topology = extractTopology(solutionPath);

    // Step 2: topological sort (excluding Belt Splits)
    const sorted = topoSort(topology);

    // Step 3: group into rows
    const rows = groupIntoRows(sorted, topology, solutionPath);

    // Step 4: assign positions and route belts
    const layout = assignPositions(rows, solutionPath, topology);

    return layout;
}

/**
 * Post-process a layout to duplicate machines for throughput.
 * Each processing machine is duplicated N times with splitters
 * distributing input and mergers collecting output.
 *
 * @param {BlueprintLayout} layout - Original layout from buildLayout()
 * @param {number} multiplier - How many copies of each machine (1 = no change)
 * @returns {BlueprintLayout} New layout with duplicated machines
 */
export function duplicateForThroughput(layout, multiplier = 1) {
    if (multiplier <= 1 || layout.machines.length === 0) return layout;

    const newMachines = [];
    const newBelts = [...layout.belts];
    let maxWidth = layout.gridWidth;

    for (const machine of layout.machines) {
        const def = machine.def;
        if (!def) {
            newMachines.push(machine);
            continue;
        }

        const mw = def.width || 1;

        // Place N copies side by side, centered on original position
        const totalWidth = multiplier * mw + (multiplier - 1) * MACHINE_GAP;
        const startX = machine.x - Math.floor((totalWidth - mw) / 2);

        for (let copy = 0; copy < multiplier; copy++) {
            const copyX = startX + copy * (mw + MACHINE_GAP);
            newMachines.push({
                ...machine,
                x: Math.max(0, copyX)
            });
        }

        // Track max width
        const rightEdge = startX + totalWidth;
        if (rightEdge > maxWidth) maxWidth = rightEdge;

        // Add splitter belt before the row of copies (distributes input)
        if (multiplier > 1) {
            const splitX = machine.x;
            const splitY = machine.y - 1;
            newBelts.push({
                x: splitX,
                y: splitY,
                floor: machine.floor,
                direction: 'S',
                kind: 'split',
                shapeCode: machine.inputShapes?.[0]
            });

            // Route from splitter to each copy's input
            for (let copy = 0; copy < multiplier; copy++) {
                const copyX = Math.max(0, startX + copy * (mw + MACHINE_GAP));
                if (copyX !== splitX) {
                    // Horizontal belt from splitter to copy
                    const dir = copyX > splitX ? 'E' : 'W';
                    let x = splitX;
                    const step = copyX > splitX ? 1 : -1;
                    while (x !== copyX) {
                        newBelts.push({
                            x, y: splitY,
                            floor: machine.floor,
                            direction: dir,
                            kind: 'normal',
                            shapeCode: machine.inputShapes?.[0]
                        });
                        x += step;
                    }
                    // Vertical belt down to machine
                    newBelts.push({
                        x: copyX, y: splitY,
                        floor: machine.floor,
                        direction: 'S',
                        kind: 'normal',
                        shapeCode: machine.inputShapes?.[0]
                    });
                }
            }

            // Add merger belt after the row of copies (collects output)
            const mergeY = machine.y + (def.depth || 1) + 1;
            newBelts.push({
                x: machine.x,
                y: mergeY,
                floor: machine.floor,
                direction: 'S',
                kind: 'merge',
                shapeCode: machine.outputShapes?.[0]
            });
        }
    }

    // Recompute grid bounds
    let gridWidth = maxWidth;
    let gridHeight = 0;
    for (const m of newMachines) {
        const right = m.x + ((m.def?.width || 1));
        const bottom = m.y + ((m.def?.depth || 1));
        if (right > gridWidth) gridWidth = right;
        if (bottom > gridHeight) gridHeight = bottom;
    }
    for (const b of newBelts) {
        if (b.x + 1 > gridWidth) gridWidth = b.x + 1;
        if (b.y + 1 > gridHeight) gridHeight = b.y + 1;
    }

    return {
        machines: newMachines,
        belts: newBelts,
        gridWidth,
        gridHeight,
        floorCount: layout.floorCount
    };
}
