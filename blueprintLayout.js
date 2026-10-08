import { extractTopology, topoSort, groupIntoRows } from './blueprintTopology.js';
import { assignPositions, MACHINE_GAP } from './blueprintPositions.js';
import { computeGridBounds } from './blueprintBounds.js';

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

// East/west tiles from `fromX` up to but not including `toX`. routeBelt's
// horizontal leg also continues into a vertical run and a merge marker, which
// this splitter row does not want.
function pushHorizontalRun(belts, fromX, toX, y, floor, shapeCode) {
    const step = toX > fromX ? 1 : -1;
    const dir = toX > fromX ? 'E' : 'W';
    for (let x = fromX; x !== toX; x += step) {
        belts.push({ x, y, floor, direction: dir, kind: 'normal', shapeCode });
    }
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
        // buildLayout always attaches def (rowEntries skips a step with none,
        // and buildingDataCoverage pins every solver op). A missing def is a
        // caller bug, not a layout this function repairs.
        const def = machine.def;
        const mw = def.width || 1;
        const inputCode = machine.inputShapes?.[0];

        // Place N copies side by side, centered on the original position.
        // Clamp the group's start, not each copy: per-copy Math.max(0, copyX)
        // collapses neighbors onto the origin when the original sits at x=0
        // (finding #8224).
        const totalWidth = multiplier * mw + (multiplier - 1) * MACHINE_GAP;
        const startX = Math.max(0, machine.x - Math.floor((totalWidth - mw) / 2));
        const copyXs = [];
        for (let copy = 0; copy < multiplier; copy++) {
            copyXs.push(startX + copy * (mw + MACHINE_GAP));
        }
        for (const copyX of copyXs) {
            newMachines.push({ ...machine, x: copyX });
        }

        const rightEdge = startX + totalWidth;
        if (rightEdge > maxWidth) maxWidth = rightEdge;

        const splitX = machine.x;
        const splitY = machine.y - 1;
        newBelts.push({
            x: splitX,
            y: splitY,
            floor: machine.floor,
            direction: 'S',
            kind: 'split',
            shapeCode: inputCode
        });

        for (const copyX of copyXs) {
            if (copyX === splitX) continue;
            pushHorizontalRun(newBelts, splitX, copyX, splitY, machine.floor, inputCode);
            newBelts.push({
                x: copyX, y: splitY,
                floor: machine.floor,
                direction: 'S',
                kind: 'normal',
                shapeCode: inputCode
            });
        }

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

    // Recompute grid bounds
    const { gridWidth, gridHeight } = computeGridBounds(newMachines, newBelts, maxWidth);

    return {
        machines: newMachines,
        belts: newBelts,
        gridWidth,
        gridHeight,
        floorCount: layout.floorCount
    };
}
