// Unit tests for blueprintTopology topoSort cycle-detection fallback (audit #3719) —
// run with:  node tests/blueprint/blueprintTopologyCycle.test.js
//
// When Kahn's algorithm cannot reach every placeable node (dependency cycle),
// topoSort appends unreached indices and logs a console.warn. This branch was
// never tested. We pin the cyclic fallback (warn + full coverage) and contrast
// it with an acyclic topology so the warn assertion is meaningful.
import { topoSort } from '../../blueprintTopology.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

function makeTwoNodeTopology(edges) {
    const nodes = new Map([
        [0, { step: { operation: 'Cutter', inputs: [], outputs: [] }, isBeltSplit: false }],
        [1, { step: { operation: 'Rotator CW', inputs: [], outputs: [] }, isBeltSplit: false }],
    ]);
    return { nodes, edges };
}

function captureWarn(fn) {
    const calls = [];
    const origWarn = console.warn;
    console.warn = (...args) => calls.push(args);
    try {
        return { result: fn(), calls };
    } finally {
        console.warn = origWarn;
    }
}

// --- cyclic topology: both nodes unreachable by Kahn's, fallback appends them ---
{
    const topology = makeTwoNodeTopology([
        { from: 0, to: 1, shapeId: 'a', shapeCode: 'CuCuCuCu' },
        { from: 1, to: 0, shapeId: 'b', shapeCode: 'RuRuRuRu' },
    ]);

    const { result, calls } = captureWarn(() => topoSort(topology));

    check('cycle: console.warn called exactly once', calls.length === 1);
    check('cycle: warn message mentions cycle detected',
        calls.length === 1 && String(calls[0][0]).includes('cycle detected'));
    check('cycle: returns without throwing (array)', Array.isArray(result));
    check('cycle: result includes placeable node 0', result.includes(0));
    check('cycle: result includes placeable node 1', result.includes(1));
    check('cycle: result covers every placeable node', result.length === 2);
}

// --- acyclic contrast: valid topological order, no warn ----------------------
{
    const topology = makeTwoNodeTopology([
        { from: 0, to: 1, shapeId: 'a', shapeCode: 'CuCuCuCu' },
    ]);

    const { result, calls } = captureWarn(() => topoSort(topology));

    check('acyclic: console.warn not called', calls.length === 0);
    check('acyclic: returns valid order (0 before 1)',
        result.indexOf(0) < result.indexOf(1));
    check('acyclic: result includes both placeable nodes',
        result.includes(0) && result.includes(1));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);