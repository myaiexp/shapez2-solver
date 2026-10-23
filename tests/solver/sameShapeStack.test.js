// Same-shape stack targets (idea #4716) — run with:
//   node tests/solver/sameShapeStack.test.js
//
// CuCuCuCu:CuCuCuCu from a single CuCuCuCu start needs a Belt Split copy fed into
// both Stacker inputs. The forward search used to drop every Belt Split, because
// both of its outputs equal the input code and the unary descriptor builder
// discards outputs equal to the input — so the split never became a successor
// and the target was unreachable at any cap. These tests pin that every method
// now finds a buildable path, and that the split is bounded: a state never holds
// more than maxLayers copies of one code, since more copies than layers cannot
// be stacked and an unbounded split would multiply the frontier.
import { shapeSolver } from '../../shapeSolverCore.js';
import { operations } from '../../shapeSolverOperations.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { expandBeltSplit } from '../../shapeSolverExpansion.js';
import { pathIsValid, pathReachesTarget } from '../shared/pathValidation.js';

let passed = 0, total = 0, failed = false;

function check(name, cond, detail = '') {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); failed = true; }
}

const ALL_OPS = Object.keys(operations);
const METHODS = ['A*', 'BFS', 'IDA*', 'Bidirectional'];
const CAP = 20000;

async function solve(target, starts, ops, method, maxLayers = 4) {
    return shapeSolver(target, starts, ops, {
        maxLayers, maxStatesPerLevel: 1000, searchMethod: method, maxStates: CAP,
    });
}

function assertSolved(label, res, target, starts, maxLayers = 4) {
    const config = new ShapeOperationConfig(maxLayers);
    const path = res && res.solutionPath;
    check(`${label}: finds a path`, Array.isArray(path),
        `aborted=${res && res.aborted}, statesExplored=${res && res.statesExplored}`);
    if (!Array.isArray(path)) return;
    check(`${label}: path is buildable`, pathIsValid(path, config, { starts }));
    check(`${label}: path reaches the target`, pathReachesTarget(path, target, { starts, config }));
    check(`${label}: path uses a Belt Split`, path.some(s => s.operation === 'Belt Split'));
}

// --- expandBeltSplit: the copy bound -----------------------------------------

{
    const desc = expandBeltSplit(7, 'CuCuCuCu', 1, 4);
    check('split of a held code yields two copies of it',
        desc && desc.type === 'Belt Split'
        && JSON.stringify(desc.inputIds) === '[7]'
        && JSON.stringify(desc.outputCodes) === '["CuCuCuCu","CuCuCuCu"]');
    check('split allowed when the count reaches maxLayers', expandBeltSplit(7, 'CuCuCuCu', 3, 4) !== null);
    check('split refused when the count would pass maxLayers', expandBeltSplit(7, 'CuCuCuCu', 4, 4) === null);
    check('split refused for an empty shape', expandBeltSplit(7, '--------', 1, 4) === null);
}

// --- end to end: every method solves a same-shape stack ----------------------

for (const method of METHODS) {
    const starts = ['CuCuCuCu'];
    const target = 'CuCuCuCu:CuCuCuCu';
    assertSolved(`${method} Split+Stacker ${target}`,
        await solve(target, starts, ['Belt Split', 'Stacker'], method), target, starts);
}

// Default ops (all enabled, as the browser runs them) for the two repros.
for (const [target, start] of [['CuCuCuCu:CuCuCuCu', 'CuCuCuCu'], ['RuRuRuRu:RuRuRuRu', 'RuRuRuRu']]) {
    assertSolved(`A* all ops ${target}`, await solve(target, [start], ALL_OPS, 'A*'), target, [start]);
}

// A four-layer same-shape stack needs four copies — exactly the maxLayers bound.
{
    const starts = ['CuCuCuCu'];
    const target = 'CuCuCuCu:CuCuCuCu:CuCuCuCu:CuCuCuCu';
    assertSolved(`A* Split+Stacker ${target}`,
        await solve(target, starts, ['Belt Split', 'Stacker'], 'A*'), target, starts);
}

// With Belt Split only, the reachable space is the copy counts 1..maxLayers —
// the bound is what keeps it finite. BFS exhausts it and reports no solution
// without hitting the cap.
{
    const res = await solve('RuRuRuRu', ['CuCuCuCu'], ['Belt Split'], 'BFS', 3);
    check('Belt Split alone: search exhausts without a cap abort',
        res && res.solutionPath === null && res.aborted === null);
    check('Belt Split alone: explores exactly maxLayers states (1..3 copies)',
        res && res.statesExplored === 3, `statesExplored=${res && res.statesExplored}`);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
