// Unit test: the blueprint layout binds each machine output SHAPE to the correct
// physical port COLUMN. smoke.js only snapshots counts (machineCount/beltCount/
// grid size) and the routeBelt unit tests only check belt geometry — none verify
// that a Cutter's left-half shape actually leaves its left port column and its
// right-half shape leaves its right port column. A left/right port inversion
// anywhere in placeMachines → buildPortLookup → routeAllBelts would pass every
// other test; this one fails on it.
//
// Run with: node tests/blueprint/portShapeMapping.test.js
import { buildLayout } from '../../blueprintLayout.js';
import { BUILDING_DATA } from '../../buildingData.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { pathIsValid } from '../shared/pathValidation.js';

let passed = 0, total = 0, failed = false;
function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

// Asymmetric Cutter: the two halves are DISTINCT codes, so a left/right port swap
// changes which code leaves which column (a symmetric cut couldn't tell them
// apart). cut(CuRuSuWu) → [----SuWu, CuRu----]; stacking them back reproduces the
// source, so the whole path is a real, physically-constructible op chain.
const LEFT = '----SuWu';   // outputs[0] → Cutter port offset 0 ("left half")
const RIGHT = 'CuRu----';  // outputs[1] → Cutter port offset 1 ("right half")
const solutionPath = [
    {
        operation: 'Cutter',
        inputs: [{ id: 'src', shape: 'CuRuSuWu' }],
        outputs: [{ id: 'o0', shape: LEFT }, { id: 'o1', shape: RIGHT }],
        params: {},
    },
    {
        operation: 'Stacker',
        inputs: [{ id: 'o0', shape: LEFT }, { id: 'o1', shape: RIGHT }],
        outputs: [{ id: 'F', shape: 'CuRuSuWu' }],
        params: {},
    },
];

// Sanity: the fixture itself is a real op chain (dogfoods the shared validator).
check('fixture is a physically valid op path', pathIsValid(solutionPath, new ShapeOperationConfig(4)));

const layout = buildLayout(solutionPath);
const cutter = layout.machines.find(m => m.operation === 'Cutter');
check('Cutter machine placed', !!cutter);

// The layout must preserve output ORDER: outputs[oi] maps to def.outputs[oi].
check('Cutter output shapes kept in port order',
    !!cutter && JSON.stringify(cutter.outputShapes) === JSON.stringify([LEFT, RIGHT]));

// Physical port columns come from the building's output offsets.
const def = BUILDING_DATA['Cutter'];
const leftCol = cutter.x + def.outputs[0].offset;   // offset 0
const rightCol = cutter.x + def.outputs[1].offset;  // offset 1
const portY = cutter.y + (def.depth || 1);          // front (south) face row
check('Cutter ports occupy distinct columns', leftCol !== rightCol);

// The belt(s) physically leaving each port column must carry that port's shape,
// and nothing at that column may carry the other half's shape. This is the
// integration check placeMachines → buildPortLookup → routeAllBelts must keep
// consistent; an inversion in any of them flips which code these assert.
const beltsAt = (x, y) => layout.belts.filter(b => b.x === x && b.y === y);
const leftBelts = beltsAt(leftCol, portY);
const rightBelts = beltsAt(rightCol, portY);
check('a belt leaves the left port column', leftBelts.length > 0);
check('a belt leaves the right port column', rightBelts.length > 0);
check('left port column carries only the left-half shape',
    leftBelts.length > 0 && leftBelts.every(b => b.shapeCode === LEFT));
check('right port column carries only the right-half shape',
    rightBelts.length > 0 && rightBelts.every(b => b.shapeCode === RIGHT));

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
