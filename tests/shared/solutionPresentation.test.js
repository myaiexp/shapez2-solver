// Standalone tests for solutionPresentation.js — run with:
//   node tests/shared/solutionPresentation.test.js
//
// main.js's presentSolution draws a live solve and a restored one through these
// helpers, so the multiplier parse, the blueprint layout and the status line
// can't drift between the two. presentSolution itself touches the DOM and
// renderers and isn't importable headlessly (main.js wires listeners at load).
import {
    parseThroughputMultiplier, buildSolutionLayout, summarizeStrategyTrace, solvedStatusText, solveFailureMessage, exploreStatus,
    isSolvedResult,
} from '../../solutionPresentation.js';
import { buildLayout, duplicateForThroughput } from '../../blueprintLayout.js';
import { LAYOUT_FIXTURES } from './layoutFixtures.js';

let passed = 0;
let total = 0;
let failed = false;

function checkEqual(name, actual, expected) {
    total++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { console.log(`✓ ${name}`); passed++; } else {
        console.log(`✗ ${name}\n    expected: ${e}\n    actual:   ${a}`);
        failed = true;
    }
}

// --- Throughput multiplier: the form's raw value, positive integer or 1 ------
for (const [value, expected] of [
    ['1', 1], ['', 1], ['abc', 1], ['0', 1], ['-2', 1], [undefined, 1], [null, 1], ['2', 2], ['2.9', 2], ['8', 8],
]) {
    checkEqual(`parseThroughputMultiplier(${JSON.stringify(value)}) → ${expected}`, parseThroughputMultiplier(value), expected);
}

// --- Layout: ×1 is the plain layout, ×N the duplicated one --------------------
{
    const path = LAYOUT_FIXTURES[0].solutionPath;
    checkEqual('buildSolutionLayout ×1 equals buildLayout', buildSolutionLayout(path, 1), buildLayout(path));
    checkEqual('buildSolutionLayout ×3 equals duplicateForThroughput(buildLayout, 3)',
        buildSolutionLayout(path, 3), duplicateForThroughput(buildLayout(path), 3));
}

// --- Already-solved: an empty path is a real layout, not a crash -------------
{
    const empty = { machines: [], belts: [], gridWidth: 0, gridHeight: 0, floorCount: 1 };
    checkEqual('buildSolutionLayout([]) ×1 is the empty layout', buildSolutionLayout([], 1), empty);
    checkEqual('buildSolutionLayout([]) ×3 stays empty (nothing to duplicate)', buildSolutionLayout([], 3), empty);
    checkEqual('buildSolutionLayout(null) is the empty layout', buildSolutionLayout(null, 1), empty);
}

// --- Status line ------------------------------------------------------------
const trace = {
    target: 'CuRuCuRu', method: 'quadrant-split', opCount: 5,
    children: [
        { target: 'CuCu----', method: 'direct-search', children: [] },
        { target: 'CuCu----', method: 'direct-search', children: [] },
        { target: '--RuRu--', method: 'layer-split', children: [{ target: '--Ru----', method: 'direct-search', children: [] }] },
    ],
};
checkEqual('summarizeStrategyTrace: split breakdown, op count, reused sub-shapes',
    summarizeStrategyTrace(trace),
    'Constructive: quadrant-split ×1, layer-split ×1 → 3 direct-searches | 5 ops | reused 1');
checkEqual('summarizeStrategyTrace: a lone direct-search',
    summarizeStrategyTrace({ target: 'Cu------', method: 'direct-search', opCount: 0, children: [] }),
    'Constructive: direct-search | 0 ops | reused 0');

// main.js routes on isSolvedResult. [] is the already-solved path the solver
// returns; a length check would send that result to the failure line.
checkEqual('isSolvedResult: empty path is solved', isSolvedResult({ solutionPath: [], depth: 0 }), true);
checkEqual('isSolvedResult: a real path is solved', isSolvedResult({ solutionPath: [{ operation: 'Cutter' }] }), true);
checkEqual('isSolvedResult: null path is a failure', isSolvedResult({ solutionPath: null }), false);
checkEqual('isSolvedResult: missing result is a failure', isSolvedResult(null), false);
checkEqual('isSolvedResult: a non-array path is a failure', isSolvedResult({ solutionPath: 'CuCuCuCu' }), false);

const solved = { solutionPath: [], depth: 3, statesExplored: 42, solveTimeSec: '0.25' };
checkEqual('solvedStatusText: no trace → time, depth, states', solvedStatusText(solved), 'Solved in 0.25s at Depth 3 → 42 States');
checkEqual('solvedStatusText: trace → Constructive summary appended',
    solvedStatusText({ ...solved, strategyTrace: trace }),
    `Solved in 0.25s at Depth 3 → 42 States | ${summarizeStrategyTrace(trace)}`);

// --- Failure status line: each abort code the solver posts (core: maxStates;
// Constructive: no-decomposition, path-invalid, preventWaste) has its own text,
// anything else — including a null result — the generic one ----------------
{
    const GENERIC = 'No solution found.';
    const abortResult = (aborted) => ({ solutionPath: null, statesExplored: 1234, aborted });
    const messages = ['maxStates', 'no-decomposition', 'path-invalid', 'preventWaste'].map(c => solveFailureMessage(abortResult(c)));
    const [maxStates, noDecomp, pathInvalid, waste] = messages;
    checkEqual('solveFailureMessage maxStates: state limit + count', maxStates.includes('state limit') && maxStates.includes('1234 states'), true);
    checkEqual('solveFailureMessage no-decomposition: node budget + count', noDecomp.includes('node budget') && noDecomp.includes('1234 states'), true);
    checkEqual('solveFailureMessage path-invalid: path does not hold the target', pathInvalid.includes('does not hold the target'), true);
    checkEqual('solveFailureMessage preventWaste: points at Prevent Waste', waste.includes('Prevent Waste'), true);
    checkEqual('solveFailureMessage: each code distinct and non-generic', new Set(messages).size === 4 && !messages.includes(GENERIC), true);
    for (const [label, result] of [['aborted: null', abortResult(null)], ['null result', null], ['unknown code', abortResult('mystery')], ['inherited name toString', abortResult('toString')]]) {
        checkEqual(`solveFailureMessage ${label} → generic`, solveFailureMessage(result), GENERIC);
    }
}

// --- Explore ----------------------------------------------------------------
const explored = { shapes: [1, 2, 3], ops: [1, 2] };
checkEqual('exploreStatus: complete', exploreStatus({ ...explored, aborted: null }, 4), 'Exploration complete — 3 shapes, 2 ops.');
checkEqual('exploreStatus: node cap', exploreStatus({ ...explored, aborted: 'maxNodes', maxNodes: 6000, depth: 3 }, 5),
    'Explored 3 shapes, 2 ops — stopped at the 6000-node cap partway through depth 3 of 5. Lower the depth or disable operations for a complete graph.');

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
