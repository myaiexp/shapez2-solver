// IDA* threshold passes (audit #12021) — run with:
//   node tests/solver/idaThreshold.test.js
//
// The weighted heuristic (divisor 0.1) makes the first threshold large enough
// that every other IDA* fixture solves or hits maxStates in pass 1, so the
// `threshold = nextThreshold` update and the Infinity-exhaustion return never
// ran. Divisor 10 on the cut-stack target is tight enough to prune, raise, and
// still solve. A rotator that cannot change the part multiset exhausts with
// nextThreshold still Infinity: a result object, no path, no aborted flag.
import { shapeSolver } from '../../shapeSolverCore.js';
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

const TARGET = 'CuCu----:RuRu----';
const STARTS = ['CuCuCuCu', 'RuRuRuRu'];
const OPS = ['Cutter', 'Stacker'];
const CONFIG = new ShapeOperationConfig(4);

async function ida(heuristicDivisor, onProgress) {
    return shapeSolver(TARGET, STARTS, OPS, {
        maxLayers: 4,
        searchMethod: 'IDA*',
        heuristicDivisor,
        shouldCancel: () => false,
        onProgress,
        maxStates: 100000,
    });
}

const raised = [];
const raisedRes = await ida(10, (message) => {
    if (String(message).includes('Increasing threshold')) raised.push(message);
});
check('divisor 10 reports at least one threshold increase', raised.length >= 1, JSON.stringify(raised));
check('divisor 10 still returns a path', Array.isArray(raisedRes?.solutionPath) && raisedRes.solutionPath.length > 0);
check('divisor 10 path passes the id gate',
    pathIsValid(raisedRes?.solutionPath, CONFIG, { starts: STARTS }));
check('divisor 10 path reaches the target',
    pathReachesTarget(raisedRes?.solutionPath, TARGET, { starts: STARTS, config: CONFIG }));

const quiet = [];
const quietRes = await ida(0.1, (message) => {
    if (String(message).includes('Increasing threshold')) quiet.push(message);
});
check('divisor 0.1 solves this target without raising the threshold',
    quiet.length === 0 && Array.isArray(quietRes?.solutionPath),
    `raises=${quiet.length} path=${quietRes?.solutionPath?.length}`);

const exhausted = await shapeSolver('CuRuRuRu', ['CuCuCuCu'], ['Rotator CW'], {
    maxLayers: 4,
    searchMethod: 'IDA*',
    heuristicDivisor: 10,
    shouldCancel: () => false,
    onProgress: () => {},
    maxStates: 5000,
});
check('unsolvable op set returns a result, not a cancel null', exhausted != null && typeof exhausted === 'object');
check('unsolvable op set has no path and no aborted flag',
    exhausted?.solutionPath === null && exhausted?.aborted == null,
    JSON.stringify(exhausted));

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
