// Rotated shapes are distinct search states (idea #6540) — run with:
//   node tests/solver/rotationState.test.js
//
// The state key used to canonicalize each held shape's rotation on its own, so a
// Rotator step mapped back onto its parent state and was dropped as visited. That
// is unsound: Cutter, Half Destroyer and Swapper act on a fixed axis, and Stacker
// depends on the inputs' relative rotation, so the orientation a shape is held in
// changes what can be built from it. Cu------ from CuCuCuCu (cut, rotate, cut) was
// unreachable at any cap, and the default-start targets below hit the state cap.
// Orientation-insensitive solves still accept any rotation of the target at the
// goal check; only the visited set stopped merging rotations.
import { shapeSolver } from '../../shapeSolverCore.js';
import { operations } from '../../shapeSolverOperations.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { getCachedShape } from '../../shapeSolverCache.js';
import { createCoverageHeuristic } from '../../shapeSolverHeuristic.js';
import { pathIsValid, pathReachesTarget } from '../shared/pathValidation.js';

let passed = 0, total = 0, failed = false;

function check(name, cond, detail = '') {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); failed = true; }
}

const ALL_OPS = Object.keys(operations);
const DEFAULT_STARTS = ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'];
const METHODS = ['A*', 'BFS', 'IDA*', 'Bidirectional'];
const CAP = 20000;
const config = new ShapeOperationConfig(4);

async function solve(target, starts, ops, method, extra = {}) {
    return shapeSolver(target, starts, ops, {
        maxStatesPerLevel: 1000, searchMethod: method, maxStates: CAP, ...extra,
    });
}

function assertSolved(label, res, target, starts, maxDepth) {
    const path = res && res.solutionPath;
    check(`${label}: finds a path`, Array.isArray(path),
        `aborted=${res && res.aborted}, statesExplored=${res && res.statesExplored}`);
    if (!Array.isArray(path)) return;
    check(`${label}: path is buildable`, pathIsValid(path, config, { starts }));
    check(`${label}: path reaches the target`, pathReachesTarget(path, target, { starts, config }));
    if (maxDepth !== undefined) {
        check(`${label}: path is at most ${maxDepth} ops`, path.length <= maxDepth, `got ${path.length}`);
    }
}

// Cut, rotate one half, cut again. Every method must see the rotated half as new.
for (const method of METHODS) {
    const starts = ['CuCuCuCu'];
    assertSolved(`${method} Cutter+Rotator Cu------`,
        await solve('Cu------', starts, ['Cutter', 'Rotator CW'], method), 'Cu------', starts, 3);
}

// The rotation step itself must appear: no other op moves a quadrant across the
// cut axis here.
{
    const res = await solve('Cu------', ['CuCuCuCu'], ['Cutter', 'Rotator CW'], 'BFS');
    check('BFS Cutter+Rotator path rotates',
        !!res?.solutionPath?.some(s => s.operation === 'Rotator CW'));
}

// The repro targets from the browser's default configuration (four starts, all ops).
// CuRuSuWu takes one quadrant from each start; forward search used to miss it at
// any cap, which is why Constructive exists.
for (const [target, maxDepth] of [['Cu------', 3], ['CuCu----:RuRu----', 3], ['CuRuSuWu', 16]]) {
    assertSolved(`A* default starts ${target}`,
        await solve(target, DEFAULT_STARTS, ALL_OPS, 'A*'), target, DEFAULT_STARTS, maxDepth);
}
// CuRuCuRu from the four default starts needs ~33k states; two starts keep the
// test fast and still capped before the fix.
{
    const starts = ['CuCuCuCu', 'RuRuRuRu'];
    assertSolved('A* all ops CuRuCuRu', await solve('CuRuCuRu', starts, ALL_OPS, 'A*'), 'CuRuCuRu', starts, 12);
}

// --- coverage heuristic ------------------------------------------------------

function heuristicFor(targetCode, orientationSensitive = false) {
    return createCoverageHeuristic({
        target: getCachedShape(targetCode), config, orientationSensitive,
        preventWaste: false, heuristicDivisor: 1,
    });
}

// Pieces only count together when one rotation of the target fits them all.
{
    const h = heuristicFor('CuRuCuRu');
    check('heuristic: compatible quadrants beat incompatible ones',
        h(['Cu------', '--Ru----']) < h(['Cu------', '----Ru--']),
        `compatible=${h(['Cu------', '--Ru----'])}, incompatible=${h(['Cu------', '----Ru--'])}`);
    check('heuristic: a held piece costs 1 more when it must be rotated',
        heuristicFor('Cu------', true)(['--Cu----']) === heuristicFor('Cu------', true)(['Cu------']) + 1);
}

// A ground-level piece counts toward an upper target layer, so a pin pushed under
// a shape is never progress.
{
    const h = heuristicFor('CuCu----:RuRu----');
    check('heuristic: Pin Pusher on the upper-layer source is not progress',
        h(['CuCuCuCu', 'P-P-P-P-:RuRuRuRu']) >= h(['CuCuCuCu', 'RuRuRuRu']));
    check('heuristic: Pin Pusher on an irrelevant shape is not progress',
        h(['CuCuCuCu', 'RuRuRuRu', 'P-P-P-P-:SuSuSuSu']) >= h(['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu']));
    check('heuristic: two clean pieces for two layers cost one stack',
        h(['CuCu----', 'RuRu----']) === 1, `got ${h(['CuCu----', 'RuRu----'])}`);
}

// Orientation-insensitive goals still accept a rotation of the target.
{
    const starts = ['----CuCu'];
    const res = await solve('CuCu----', starts, ['Rotator CW'], 'BFS');
    check('already-held rotation of the target is a zero-op goal',
        Array.isArray(res?.solutionPath) && res.solutionPath.length === 0,
        `path=${JSON.stringify(res?.solutionPath)}`);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
