// Pins BFS beam pruning (maxStatesPerLevel) and A* heuristicDivisor at values
// that actually change the answer. Every other caller in the suite uses beam
// 1000 and divisor 0.1, so a no-op prune or a divisor that never weights
// would still pass CI. Run with: node tests/solver/beamWidth.test.js
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
const noCancel = () => false;
const noop = () => {};

function solved(res) {
    return !!(res && res.solutionPath && !res.aborted);
}

function valid(res) {
    return solved(res)
        && pathIsValid(res.solutionPath, CONFIG, { starts: STARTS })
        && pathReachesTarget(res.solutionPath, TARGET, { starts: STARTS, config: CONFIG });
}

async function bfs(beam) {
    return shapeSolver(TARGET, STARTS, OPS, {
        maxLayers: 4,
        maxStatesPerLevel: beam,
        searchMethod: 'BFS',
        shouldCancel: noCancel,
        onProgress: noop,
        maxStates: 100000,
    });
}

async function astar(heuristicDivisor) {
    return shapeSolver(TARGET, STARTS, OPS, {
        maxLayers: 4,
        maxStatesPerLevel: 1000,
        searchMethod: 'A*',
        heuristicDivisor,
        shouldCancel: noCancel,
        onProgress: noop,
        maxStates: 100000,
    });
}

const beam1 = await bfs(1);
const beam2 = await bfs(2);
const beamWide = await bfs(1000);

check('beam 1 still returns a valid path', valid(beam1));
check('beam 2 returns a valid path', valid(beam2));
check('unpruned beam returns a valid path', valid(beamWide));

// Beam 1 is narrow enough to drop the depth-2 assembly and keep searching;
// a no-op prune would also find the 2-op path and this assertion would fail.
check('beam 1 path is 3 ops / depth 3 (prune is live)',
    beam1.solutionPath?.length === 3 && beam1.depth === 3,
    `ops=${beam1.solutionPath?.length} depth=${beam1.depth}`);
check('beam 2 path is 2 ops / depth 2',
    beam2.solutionPath?.length === 2 && beam2.depth === 2,
    `ops=${beam2.solutionPath?.length} depth=${beam2.depth}`);
check('unpruned beam path is 2 ops / depth 2',
    beamWide.solutionPath?.length === 2 && beamWide.depth === 2,
    `ops=${beamWide.solutionPath?.length} depth=${beamWide.depth}`);

check('wider beam never returns a longer BFS path than a narrower one',
    beam2.solutionPath.length <= beam1.solutionPath.length
    && beamWide.solutionPath.length <= beam2.solutionPath.length);

// Beam 1 can visit *more* states than beam 2 because it goes a level deeper.
// Among beams that find the same-length path, a wider beam is non-decreasing.
check('statesExplored is non-decreasing from beam 2 to unpruned',
    typeof beam2.statesExplored === 'number'
    && typeof beamWide.statesExplored === 'number'
    && beamWide.statesExplored >= beam2.statesExplored,
    `beam2=${beam2.statesExplored} wide=${beamWide.statesExplored}`);

const greedy = await astar(0.1);
const bounded = await astar(10);

check('default heuristicDivisor still solves', valid(greedy));
check('larger heuristicDivisor still solves', valid(bounded));
// Default 0.1 is weighted A* (W=10) and takes the 3-op greedy path; divisor
// 10 is close to g-only and finds the 2-op path. A no-op divisor would keep
// both at 3 ops.
check('default divisor takes the 3-op greedy path',
    greedy.solutionPath?.length === 3,
    `ops=${greedy.solutionPath?.length}`);
check('larger divisor path is no longer than the default (2 ops)',
    bounded.solutionPath?.length === 2
    && bounded.solutionPath.length <= greedy.solutionPath.length,
    `ops=${bounded.solutionPath?.length}`);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
