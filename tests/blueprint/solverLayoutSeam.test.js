// Solver → layout seam: feed buildLayout a path the Constructive planner
// actually produced, not a hand-written fixture. Run with:
//   node tests/blueprint/solverLayoutSeam.test.js
//
// LAYOUT_FIXTURES never include chained Belt Splits from a real solve, so a
// mismatch in id shapes / output ordering / Belt Split chaining would only
// show up in production. This target emits a split that consumes another
// split's output — the recursive findDownstreamPlaceable walk.
import { solveConstructive } from '../../shapeSolverConstructive.js';
import { operations } from '../../shapeSolverOperations.js';
import { buildLayout } from '../../blueprintLayout.js';
import { BUILDING_DATA } from '../../buildingData.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import {
    invalidPathSteps,
    invalidPathIds,
    pathReachesTarget,
} from '../shared/pathValidation.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

const TARGET = 'CuRu----:CuRu----:CuRu----';
const STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'];
const ALL_OPS = Object.keys(operations);
const CONFIG = new ShapeOperationConfig(4);

function hasChainedBeltSplits(path) {
    const producedBySplit = new Set();
    for (const step of path) {
        if (step.operation !== 'Belt Split') continue;
        if (step.inputs.some((inp) => producedBySplit.has(inp.id))) return true;
        for (const out of step.outputs) producedBySplit.add(out.id);
    }
    return false;
}

function inputPort(machine, inputIndex) {
    const def = machine.def;
    let offset = def.inputs[inputIndex] ? def.inputs[inputIndex].offset : inputIndex;
    if (inputIndex > 0 && def.inputs[inputIndex] && def.inputs[inputIndex - 1]
        && def.inputs[inputIndex].offset === def.inputs[inputIndex - 1].offset) {
        offset = inputIndex;
    }
    return {
        x: machine.x + offset,
        y: machine.y,
        floor: def.inputs[inputIndex]?.floor ?? machine.floor,
    };
}

function beltsFeedInput(layout, machine, inputIndex) {
    const port = inputPort(machine, inputIndex);
    // routeBelt stops one tile north of the machine back face.
    return layout.belts.some((b) => b.x === port.x && b.y === port.y - 1 && b.floor === port.floor);
}

const result = await solveConstructive(TARGET, STARTS, ALL_OPS, { maxLayers: 4 });
const path = result?.solutionPath ?? null;

check('constructive solved the 3-layer reuse target', !!path, `aborted=${result?.aborted}`);

if (path) {
    const badSteps = invalidPathSteps(path, CONFIG);
    check('solver path steps are real ops', badSteps.length === 0, badSteps.join(' | '));
    const badIds = invalidPathIds(path, { starts: STARTS });
    check('solver path id flow is buildable', badIds.length === 0, badIds.join(' | '));
    check('solver path reaches the target',
        pathReachesTarget(path, TARGET, { starts: STARTS, config: CONFIG }));
    check('path contains a chained Belt Split (split consumes a split)',
        hasChainedBeltSplits(path));

    const layout = buildLayout(path);
    const placeable = path.filter((s) => s.operation !== 'Belt Split');
    const missingDef = placeable.filter((s) => !BUILDING_DATA[s.operation]);

    check('every non-Belt-Split step has a BUILDING_DATA def',
        missingDef.length === 0,
        missingDef.map((s) => s.operation).join(', '));
    check('every non-Belt-Split step got a machine (none dropped)',
        layout.machines.length === placeable.length,
        `machines=${layout.machines.length} placeable=${placeable.length}`);
    check('every placed machine carries its BUILDING_DATA def',
        layout.machines.every((m) => m.def && m.def === BUILDING_DATA[m.operation]));

    const unfed = [];
    for (const machine of layout.machines) {
        for (let i = 0; i < machine.inputShapes.length; i++) {
            if (!beltsFeedInput(layout, machine, i)) {
                unfed.push(`${machine.operation} input ${i}`);
            }
        }
    }
    check('every machine input port has a belt feeding it',
        unfed.length === 0, unfed.join(', '));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
