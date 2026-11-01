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

    const topology = extractTopology(solutionPath);

    const sorted = topoSort(topology);

    const rows = groupIntoRows(sorted, topology);

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

// Copy columns for every machine, packed per row. Each machine's N copies are
// centered on its own x, but a row's groups go left to right with at least
// MACHINE_GAP between them: centering each group alone stacked row-mates'
// copies onto each other (two adjacent machines at ×4 both spanned x 0..6).
// The group start is clamped, not each copy: per-copy Math.max(0, copyX)
// collapses neighbors onto the origin when a machine sits at x=0 (finding #8224).
function packCopyColumns(machines, multiplier) {
    const rows = new Map();
    for (const machine of machines) {
        if (!rows.has(machine.y)) rows.set(machine.y, []);
        rows.get(machine.y).push(machine);
    }
    const columns = new Map();
    for (const row of rows.values()) {
        row.sort((a, b) => a.x - b.x);
        let nextFreeX = 0;
        for (const machine of row) {
            const mw = machine.def.width || 1;
            const totalWidth = multiplier * mw + (multiplier - 1) * MACHINE_GAP;
            const startX = Math.max(nextFreeX, machine.x - Math.floor((totalWidth - mw) / 2));
            columns.set(machine, Array.from({ length: multiplier }, (_, copy) => startX + copy * (mw + MACHINE_GAP)));
            nextFreeX = startX + totalWidth + MACHINE_GAP;
        }
    }
    return columns;
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
    const columns = packCopyColumns(layout.machines, multiplier);

    for (const machine of layout.machines) {
        // buildLayout always attaches def (rowEntries skips a step with none,
        // and buildingDataCoverage pins every solver op). A missing def is a
        // caller bug, not a layout this function repairs.
        const def = machine.def;
        const mw = def.width || 1;
        const inputCode = machine.inputShapes?.[0];

        const copyXs = columns.get(machine);
        for (const copyX of copyXs) {
            newMachines.push({ ...machine, x: copyX });
        }

        const rightEdge = copyXs[copyXs.length - 1] + mw;
        if (rightEdge > maxWidth) maxWidth = rightEdge;

        // The splitter stays at the original x, where buildLayout routed this
        // machine's input belt; a group packed off that column is still fed
        // through the horizontal run.
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

    const { gridWidth, gridHeight } = computeGridBounds(newMachines, newBelts, maxWidth);

    return {
        machines: newMachines,
        belts: newBelts,
        gridWidth,
        gridHeight,
        floorCount: layout.floorCount
    };
}
