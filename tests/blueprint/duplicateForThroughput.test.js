// Unit tests for blueprintLayout.duplicateForThroughput (audit #3718) —
// run with:  node tests/blueprint/duplicateForThroughput.test.js
//
// duplicateForThroughput post-processes a buildLayout() result to place N
// side-by-side copies of each machine with split/merge belt routing. These
// tests pin the no-op boundary (multiplier <= 1), copy placement/centering
// math, distinct copy columns, belt kinds/counts, and grid expansion.
import { buildLayout, duplicateForThroughput } from '../../blueprintLayout.js';
import { MACHINE_GAP } from '../../blueprintPositions.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { pathIsValid } from '../shared/pathValidation.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

// cut() returns [left, right] = [----CuCu, CuCu----]; stacking them gravity-
// merges back to CuCuCuCu. Must pass the shared path gate so this suite does
// not dogfood a swapped-port / fabricated-product sequence (finding #6249).
const solutionPath = [
    {
        operation: 'Cutter',
        inputs: [{ id: 'src', shape: 'CuCuCuCu' }],
        outputs: [{ id: 'L', shape: '----CuCu' }, { id: 'R', shape: 'CuCu----' }],
        params: {}
    },
    {
        operation: 'Stacker',
        inputs: [{ id: 'L', shape: '----CuCu' }, { id: 'R', shape: 'CuCu----' }],
        outputs: [{ id: 'out', shape: 'CuCuCuCu' }],
        params: {}
    }
];

check('fixture is a physically valid op path',
    pathIsValid(solutionPath, new ShapeOperationConfig(4)));

const layout = buildLayout(solutionPath);
const origMachineCount = layout.machines.length;
const origBeltCount = layout.belts.length;
const origSplitCount = layout.belts.filter(b => b.kind === 'split').length;
const origMergeCount = layout.belts.filter(b => b.kind === 'merge').length;

// --- multiplier <= 1: layout returned unchanged --------------------------------
{
    const unchanged = duplicateForThroughput(layout, 1);
    check('multiplier 1: returns same layout reference', unchanged === layout);
    check('multiplier 1: machine count unchanged', unchanged.machines.length === origMachineCount);
    check('multiplier 1: belt count unchanged', unchanged.belts.length === origBeltCount);
}

{
    const unchanged = duplicateForThroughput(layout, 0);
    check('multiplier 0: returns same layout reference', unchanged === layout);
}

{
    const empty = { machines: [], belts: [], gridWidth: 0, gridHeight: 0, floorCount: 1 };
    const unchanged = duplicateForThroughput(empty, 5);
    check('empty layout: returns same reference even with multiplier > 1', unchanged === empty);
}

// --- multiplier 3: copies, belt kinds, wider grid ------------------------------
const MULT = 3;
const dup = duplicateForThroughput(layout, MULT);

check('multiplier 3: machine count is N × original',
    dup.machines.length === MULT * origMachineCount);
check('multiplier 3: belt count strictly greater than original',
    dup.belts.length > origBeltCount);
check('multiplier 3: layout includes split belts',
    dup.belts.some(b => b.kind === 'split'));
check('multiplier 3: layout includes merge belts',
    dup.belts.some(b => b.kind === 'merge'));
check('multiplier 3: gridWidth >= original gridWidth',
    dup.gridWidth >= layout.gridWidth);

// Exact belt-kind counts: one split and one merge added per source machine.
check('multiplier 3: split belt count equals source machine count',
    dup.belts.filter(b => b.kind === 'split').length === origSplitCount + origMachineCount);
check('multiplier 3: merge belt count grows by one per source machine',
    dup.belts.filter(b => b.kind === 'merge').length === origMergeCount + origMachineCount);

// Distinct columns on the unshifted buildLayout() result at multiplier 3 —
// the case that actually hits the x=0 clamp. Multiplier 2 at x=0 happens to
// stay distinct even with per-copy Math.max(0, copyX); multiplier 3 does not
// (finding #8224).
{
    for (const source of layout.machines) {
        const copies = dup.machines.filter(
            m => m.operation === source.operation && m.y === source.y && m.floor === source.floor
        );
        const xs = copies.map(m => m.x);
        check(`multiplier 3: ${source.operation} copies occupy distinct x columns on unshifted layout (x=${source.x})`,
            xs.length === MULT && new Set(xs).size === MULT);
    }

    const cutterXs = dup.machines.filter(m => m.operation === 'Cutter').map(m => m.x);
    check('left-edge clamp: Cutter copies sit at [0, 3, 6] (group shifted, not per-copy clamped)',
        cutterXs.length === MULT && cutterXs[0] === 0 && cutterXs[1] === 3 && cutterXs[2] === 6);
}

// --- exact centering math (multiplier 3, machine shifted away from x=0 clamp) ---
{
    const centered = buildLayout(solutionPath);
    const cutter = centered.machines.find(m => m.operation === 'Cutter');
    cutter.x = 5;

    const mw = cutter.def.width;
    const totalWidth = MULT * mw + (MULT - 1) * MACHINE_GAP;
    const startX = Math.max(0, cutter.x - Math.floor((totalWidth - mw) / 2));
    const expectedXs = Array.from({ length: MULT }, (_, copy) =>
        startX + copy * (mw + MACHINE_GAP)
    );

    const dupCentered = duplicateForThroughput(centered, MULT);
    const cutterCopies = dupCentered.machines
        .filter(m => m.operation === 'Cutter')
        .map(m => m.x);

    check('centering math: Cutter copy x-coordinates match formula',
        cutterCopies.length === MULT
        && cutterCopies.every((x, i) => x === expectedXs[i]));
    check('centering math: expected copy columns are [2, 5, 8] for width=2, gap=1, source x=5',
        expectedXs[0] === 2 && expectedXs[1] === 5 && expectedXs[2] === 8);
    check('centering math: three copies occupy three distinct x columns',
        new Set(cutterCopies).size === MULT);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);