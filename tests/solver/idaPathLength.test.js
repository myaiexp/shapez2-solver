// IDA* path length (idea #6547) — run with:
//   node tests/solver/idaPathLength.test.js
//
// The weighted heuristic (divisor 0.1, ×10) sets a first threshold far above
// the real depth, so the first depth-first pass used to return whichever goal
// its successor order hit first: 21 ops for Cu------ and 5 for the cut-stack
// target, where 3 suffice. The pass that finds a goal now keeps searching,
// bounded by g + the unweighted estimate against the best length so far. The
// CuRuCuRu pass needs about 130k states to reach its 9 ops.
import { shapeSolver } from '../../shapeSolverCore.js';
import { operations } from '../../shapeSolverOperations.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { pathIsValid, pathReachesTarget } from '../shared/pathValidation.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

const CONFIG = new ShapeOperationConfig(4);
const DEFAULT_STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'];
const ALL_OPS = Object.keys(operations);

const CASES = [
    { name: 'Cu------ (orientation)', target: 'Cu------', starts: DEFAULT_STARTS, ops: ALL_OPS, orientationSensitive: true, maxOps: 3 },
    { name: 'cut-stack', target: 'CuCu----:RuRu----', starts: ['CuCuCuCu', 'RuRuRuRu'], ops: ['Cutter', 'Stacker'], maxOps: 3 },
    { name: 'CuRuCuRu', target: 'CuRuCuRu', starts: DEFAULT_STARTS, ops: ALL_OPS, maxOps: 10 },
];

for (const c of CASES) {
    const res = await shapeSolver(c.target, c.starts, c.ops, {
        maxLayers: 4,
        searchMethod: 'IDA*',
        orientationSensitive: !!c.orientationSensitive,
        shouldCancel: () => false,
        onProgress: () => {},
        maxStates: 200000,
    });
    const path = res?.solutionPath;
    check(`${c.name}: solves`, Array.isArray(path) && path.length > 0, JSON.stringify(res && { ...res, solutionPath: undefined }));
    check(`${c.name}: path is at most ${c.maxOps} ops`, path?.length <= c.maxOps, `got ${path?.length}`);
    check(`${c.name}: depth matches the path length`, res?.depth === path?.length);
    check(`${c.name}: path passes the id gate`, pathIsValid(path, CONFIG, { starts: c.starts }));
    check(`${c.name}: path reaches the target`,
        pathReachesTarget(path, c.target, { starts: c.starts, config: CONFIG, orientationSensitive: !!c.orientationSensitive }));
}

// The browser sends no maxStates, so the search for a shorter path must end on
// its own. CuRuSuWu's pass would run to any cap; the stall rule stops it at
// IDA_STALL_FACTOR (3) × max(states at the last improvement, 5000). The
// deadline turns a regression into a failure (cancel → null), not a hung run.
{
    const deadline = performance.now() + 60000;
    let lastAt = null;
    const res = await shapeSolver('CuRuSuWu', DEFAULT_STARTS, ALL_OPS, {
        maxLayers: 4, searchMethod: 'IDA*',
        shouldCancel: () => performance.now() > deadline,
        onProgress: (m) => {
            const hit = /Found \d+-op path.*Distinct:(\d+)/.exec(String(m));
            if (hit) lastAt = Number(hit[1]);
        },
    });
    check('uncapped: returns a path without hitting the deadline', Array.isArray(res?.solutionPath), JSON.stringify(res && { ...res, solutionPath: undefined }));
    check('uncapped: not reported as aborted', res?.aborted == null);
    check('uncapped: stopped at 3× the states of the last improvement',
        lastAt !== null && res?.statesExplored <= 3 * Math.max(lastAt, 5000) + 64,
        `last improvement at ${lastAt}, stopped at ${res?.statesExplored}`);
}

// A cap hit after a goal was found returns that goal rather than aborting:
// CuRuCuRu's first goal comes at ~4.8k states, well inside 10k.
{
    const res = await shapeSolver('CuRuCuRu', DEFAULT_STARTS, ALL_OPS, {
        maxLayers: 4, searchMethod: 'IDA*', shouldCancel: () => false, onProgress: () => {}, maxStates: 10000,
    });
    check('cap after a goal: returns the path', Array.isArray(res?.solutionPath) && res.solutionPath.length > 0);
    check('cap after a goal: not reported as aborted', res?.aborted == null, JSON.stringify(res?.aborted));
    check('cap after a goal: path reaches the target',
        pathReachesTarget(res?.solutionPath, 'CuRuCuRu', { starts: DEFAULT_STARTS, config: CONFIG }));
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
