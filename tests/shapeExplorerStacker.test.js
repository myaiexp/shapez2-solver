// Unit tests for shapeExplorer's 2-input Stacker branch and symmetric-order
// dedup logic (audit #3721) — run with:  node tests/shapeExplorerStacker.test.js
//
// The explorer's inputCount===2 path iterates id1 over all shapes × id2 over the
// frontier. For Stacker, when stack(A,B) equals stack(B,A) it records only the
// id1 < id2 ordering; when the outputs differ it records both orderings. No
// existing fixture or depth-limit test reaches this branch (fixtures use
// Cutter+Rotator only; shapeExplorerDepthLimit.test.js excludes Stacker).
import { shapeExplorer } from '../shapeSolverCore.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const STACKER_ONLY = ['Stacker'];
const noCancel = () => false;
const noop = () => {};

function explore(starts) {
    return shapeExplorer(starts, STACKER_ONLY, /* depthLimit */ 1, /* maxLayers */ 4, noCancel, noop);
}

function countStackerOpsForPair(g, idA, idB) {
    const a = `shape-${idA}`;
    const b = `shape-${idB}`;
    const want = [a, b].sort();
    return g.ops.filter(op => {
        if (op.type !== 'Stacker') return false;
        const inputs = g.edges
            .filter(e => e.target === op.id && e.source.startsWith('shape-'))
            .map(e => e.source)
            .sort();
        if (inputs.length !== 2 || inputs[0] === inputs[1]) return false;
        return inputs[0] === want[0] && inputs[1] === want[1];
    }).length;
}

// --- Symmetric stack: complementary halves merge order-independently -----------
{
    const g = await explore(['CuCu----', '----CuCu']);
    check('symmetric: returns a graph object (not null)', g != null);
    check('symmetric: both starting shapes present',
        g != null && g.shapes.some(s => s.code === 'CuCu----')
        && g.shapes.some(s => s.code === '----CuCu'));
    check('symmetric: exactly one Stacker op for the complementary pair',
        g != null && countStackerOpsForPair(g, 0, 1) === 1);
}

// --- Asymmetric stack: full layers differ by stacking order --------------------
{
    const g = await explore(['CuCuCuCu', 'RuRuRuRu']);
    check('asymmetric: returns a graph object (not null)', g != null);
    check('asymmetric: both starting shapes present',
        g != null && g.shapes.some(s => s.code === 'CuCuCuCu')
        && g.shapes.some(s => s.code === 'RuRuRuRu'));
    check('asymmetric: exactly two Stacker ops for the distinct pair (both orderings)',
        g != null && countStackerOpsForPair(g, 0, 1) === 2);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);