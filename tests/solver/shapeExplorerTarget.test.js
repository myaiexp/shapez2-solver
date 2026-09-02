// Unit tests for shapeExplorer's targetShapeCode color narrowing (finding #8619).
// Run with: node tests/solver/shapeExplorerTarget.test.js
//
// Without a target the explorer unions Painter colors from every inventory
// shape; with a target it uses getPaintColors against that target only. Same
// starts/ops, two runs — the target-supplied run must emit fewer Painter nodes
// and only the target-implied color. Smoke's painter-with-target fixture pins
// the 7th-arg plumbing; this file asserts the structural difference.
import { shapeExplorer } from '../../shapeExplorerCore.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const STARTS = ['CuCuCuCu', 'CrCrCrCr', 'CgCgCgCg'];
const OPS = ['Painter'];
const TARGET = 'CrCrCrCr';
const noCancel = () => false;
const noop = () => {};

function painterColors(g) {
    return [...new Set((g?.ops || []).filter(o => o.type === 'Painter').map(o => o.params?.color))].sort();
}

const none = await shapeExplorer(STARTS, OPS, 1, 4, noCancel, noop);
const withTarget = await shapeExplorer(STARTS, OPS, 1, 4, noCancel, noop, TARGET);

check('no-target: returns a graph', none != null);
check('with-target: returns a graph', withTarget != null);

const nonePainters = (none?.ops || []).filter(o => o.type === 'Painter').length;
const withPainters = (withTarget?.ops || []).filter(o => o.type === 'Painter').length;
check('no-target: Painter ops actually ran (inventory colors live)', nonePainters > 0);
check('with-target: fewer Painter ops than the null-target run', withPainters < nonePainters);
check('with-target: only the target-implied color (r)',
    JSON.stringify(painterColors(withTarget)) === JSON.stringify(['r']));
check('no-target: unions colors from inventory (r and g)',
    JSON.stringify(painterColors(none)) === JSON.stringify(['g', 'r']));

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
