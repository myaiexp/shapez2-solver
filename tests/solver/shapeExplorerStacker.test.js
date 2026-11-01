// Unit tests for shapeExplorer's 2-input Stacker branch and symmetric-order
// dedup logic (audit #3721) — run with:  node tests/solver/shapeExplorerStacker.test.js
//
// The explorer's inputCount===2 path pairs the inventory with the previous
// depth's frontier. Stacker is order-sensitive, so it also pairs the frontier
// with the older shapes (bottom = newer, top = older). When stack(A,B) equals
// stack(B,A) it records only the id1 < id2 ordering; when the outputs differ it
// records both orderings. No existing fixture or depth-limit test reaches this
// branch (fixtures use Cutter+Rotator only; shapeExplorerDepthLimit.test.js
// excludes Stacker).
import { shapeExplorer } from '../../shapeExplorerCore.js';
import { operations } from '../../shapeSolverOperations.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { getCachedShape } from '../../shapeSolverCache.js';

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

// Op inputs in edge order, so a test can tell Stacker(A,B) from Stacker(B,A).
function stackerInputPairs(g) {
    return g.ops.filter(op => op.type === 'Stacker').map(op =>
        g.edges.filter(e => e.target === op.id).map(e => e.source).join('|'));
}

// --- Depth 2: a frontier shape goes on the bottom of an older shape too --------
{
    const g = await shapeExplorer(['CuCuCuCu'], ['Cutter', 'Stacker'], 2, 4, noCancel, noop);
    const codes = new Set(g.shapes.map(s => s.code));
    check('depth 2: older shape on the bottom of a depth-1 product is found',
        codes.has('CuCuCuCu:CuCu----'));
    check('depth 2: depth-1 product on the bottom of an older shape is found',
        codes.has('CuCu----:CuCuCuCu'));

    const pairs = stackerInputPairs(g);
    check('depth 2: no Stacker input order is recorded twice',
        new Set(pairs).size === pairs.length);
}

// --- Depth 3: two shapes older than the frontier are not paired again ----------
{
    const g = await shapeExplorer(['CuCuCuCu'], ['Cutter', 'Stacker'], 3, 4, noCancel, noop);
    const pairs = stackerInputPairs(g);
    check('depth 3: no Stacker input order is recorded twice',
        new Set(pairs).size === pairs.length);
}

// --- Oracle: the BFS finds what all ordered pairs would, level by level --------
// The explorer's frontier pairing is an optimization of "apply every binary op to
// every ordered pair of the inventory", which is what the solver's successor
// generation does, so the two must agree on the shapes each depth reaches.
function bruteForceCodes(starts, opNames, depthLimit, config) {
    const codes = new Set(starts);
    const apply = (op, ...inputs) => {
        for (const out of op.fn(...inputs.map(getCachedShape), config)) {
            if (!out.isEmpty()) codes.add(out.toShapeCode());
        }
    };
    for (let level = 0; level < depthLimit; level++) {
        const inventory = [...codes];
        for (const opName of opNames) {
            const op = operations[opName];
            for (const a of inventory) {
                if (op.inputCount === 1) { apply(op, a); continue; }
                for (const b of inventory) apply(op, a, b);
            }
        }
    }
    return codes;
}

for (const [label, starts, ops, depth] of [
    ['Cutter+Stacker depth 3', ['CuCuCuCu'], ['Cutter', 'Stacker'], 3],
    ['two starts depth 3', ['CuRuCuRu', 'SuSuWuWu'], ['Cutter', 'Stacker'], 3],
    ['Swapper+Stacker depth 2', ['CuCuRuRu', 'SuWuSuWu'], ['Swapper', 'Stacker'], 2],
]) {
    const g = await shapeExplorer(starts, ops, depth, 4, noCancel, noop);
    const found = new Set(g.shapes.map(s => s.code));
    const expected = bruteForceCodes(starts, ops, depth, new ShapeOperationConfig(4));
    const missing = [...expected].filter(c => !found.has(c));
    const extra = [...found].filter(c => !expected.has(c));
    check(`oracle: ${label} matches every-ordered-pair expansion`
        + (missing.length + extra.length ? ` (missing ${missing.length}, extra ${extra.length})` : ''),
        missing.length === 0 && extra.length === 0);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);