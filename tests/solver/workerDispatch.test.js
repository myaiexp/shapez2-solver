// Contract tests for the Web Worker wrapper (finding #8617) — run with:
//   node tests/solver/workerDispatch.test.js
//
// Every other solver test imports shapeSolverCore / shapeExplorerCore /
// shapeSolverConstructive directly. The browser talks to shapeSolver.js, which
// is the only file that dispatches Constructive vs core, aliases the three
// budgets, clamps explore depth, and posts {type: result|status|error}. Stub
// `self` before the dynamic import (the file only assigns self.onmessage at
// load) and drive the handler as the Worker would.
import { shapeExplorer } from '../../shapeExplorerCore.js';
import { MAX_EXPLORE_DEPTH } from '../../exploreDepth.js';

const sent = [];
globalThis.self = {
    postMessage(m) { sent.push(m); },
    onmessage: null,
};
await import('../../shapeSolver.js');

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

function dispatch(action, data) {
    return self.onmessage({ data: { action, data } });
}

function resultsOf(type) {
    return sent.filter(m => m.type === type);
}

function graphKey(g) {
    if (!g) return null;
    return JSON.stringify({
        shapes: [...g.shapes.map(s => s.code)].sort(),
        ops: [...g.ops.map(o => `${o.type}:${o.params?.color ?? ''}`)].sort(),
        edges: g.edges.length,
    });
}

const STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'];

// --- Constructive dispatch: strategyTrace is planner-only --------------------
{
    sent.length = 0;
    await dispatch('solve', {
        targetShapeCode: 'CuCuCuCu:RuRuRuRu',
        startingShapeCodes: ['CuCuCuCu', 'RuRuRuRu'],
        enabledOperations: ['Stacker', 'Cutter', 'Belt Split'],
        maxLayers: 4,
        searchMethod: 'Constructive',
        nodeBudget: 4000,
    });
    const res = resultsOf('result')[0]?.result;
    check('constructive: posts a result (not error)', resultsOf('error').length === 0 && res != null);
    check('constructive: result carries strategyTrace (planner, not core)',
        res != null && res.strategyTrace != null && typeof res.strategyTrace.method === 'string');
    check('constructive: solved the 1-stack target',
        Array.isArray(res?.solutionPath) && res.solutionPath.length === 1);
}

// --- nodeBudget reaches Constructive, not the core maxStates alias -----------
// CuCu---- is a 1-op cut. nodeBudget: 1 fail-fasts the inner A* before that
// successor is dequeued, and without a solving split the planner aborts
// no-decomposition. If the worker ignored nodeBudget (default 4000) or fed
// maxStatesPerLevel/maxStates into core instead, this would come back solved.
{
    sent.length = 0;
    await dispatch('solve', {
        targetShapeCode: 'CuCu----',
        startingShapeCodes: ['CuCuCuCu'],
        enabledOperations: ['Cutter', 'Stacker', 'Belt Split'],
        maxLayers: 4,
        searchMethod: 'Constructive',
        nodeBudget: 1,
        maxStatesPerLevel: 100000,
        maxStates: 100000,
    });
    const res = resultsOf('result')[0]?.result;
    check('nodeBudget: posts a result object (Constructive never returns bare null)',
        res != null && typeof res === 'object');
    check('nodeBudget: 1-state cap abort is no-decomposition, not a solved path',
        res?.solutionPath == null && res?.aborted === 'no-decomposition');
}

// --- Explore depthLimit 999 is clamped to MAX_EXPLORE_DEPTH ------------------
{
    const starts = ['CuRuSuWu'];
    const ops = ['Cutter', 'Rotator CW'];
    sent.length = 0;
    await dispatch('explore', {
        startingShapeCodes: starts,
        enabledOperations: ops,
        depthLimit: 999,
        maxLayers: 4,
    });
    const workerGraph = resultsOf('result')[0]?.result;
    const direct = await shapeExplorer(starts, ops, MAX_EXPLORE_DEPTH, 4, () => false, () => {});
    check('explore-clamp: posts a graph', workerGraph != null && Array.isArray(workerGraph.shapes));
    check('explore-clamp: matches a direct explorer call at MAX_EXPLORE_DEPTH',
        graphKey(workerGraph) === graphKey(direct));
    const shallow = await shapeExplorer(starts, ops, 1, 4, () => false, () => {});
    check('explore-clamp: 999 did not collapse to depth 1 (in-range depth still expands further)',
        (workerGraph?.ops?.length ?? 0) > (shallow?.ops?.length ?? 0));
}

// --- cancel posts status; an in-flight solve then posts no result ------------
{
    sent.length = 0;
    await dispatch('cancel');
    check('cancel: posts a status message',
        resultsOf('status').length === 1 && resultsOf('status')[0].message === 'Cancelled.');
    check('cancel: posts no result', resultsOf('result').length === 0);

    sent.length = 0;
    const solveP = dispatch('solve', {
        targetShapeCode: 'CuRuSuWu',
        startingShapeCodes: STARTS,
        enabledOperations: ['Cutter', 'Rotator CW', 'Rotator CCW', 'Rotator 180', 'Stacker', 'Painter', 'Swapper', 'Half Destroyer'],
        maxLayers: 4,
        maxStatesPerLevel: 1000,
        searchMethod: 'A*',
        maxStates: 100000,
    });
    const deadline = Date.now() + 5000;
    while (!sent.some(m => m.type === 'status') && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 10));
    }
    check('in-flight: search yielded a progress status before cancel',
        sent.some(m => m.type === 'status'));
    await dispatch('cancel');
    await solveP;
    check('in-flight: cancel status posted',
        sent.some(m => m.type === 'status' && m.message === 'Cancelled.'));
    check('in-flight: no result posted after cancel',
        resultsOf('result').length === 0);
}

// --- malformed target posts {type:'error'}, does not reject ------------------
{
    sent.length = 0;
    let threw = false;
    try {
        await dispatch('solve', {
            targetShapeCode: null,
            startingShapeCodes: ['CuCuCuCu'],
            enabledOperations: ['Cutter'],
            maxLayers: 4,
            searchMethod: 'A*',
        });
    } catch {
        threw = true;
    }
    check('malformed: handler does not reject', !threw);
    check('malformed: posts an error message',
        resultsOf('error').length === 1 && typeof resultsOf('error')[0].message === 'string');
    check('malformed: error message is prefixed',
        resultsOf('error')[0]?.message?.startsWith('Error: ') === true);
    check('malformed: posts no result', resultsOf('result').length === 0);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
