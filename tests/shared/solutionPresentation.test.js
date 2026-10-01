// Standalone tests for solutionPresentation.js — run with:
//   node tests/shared/solutionPresentation.test.js
//
// main.js's presentSolution draws a live solve and a restored one through these
// helpers, so the multiplier parse, the blueprint layout and the status line
// can't drift between the two. presentSolution itself touches the DOM and
// renderers and isn't importable headlessly (main.js wires listeners at load).
import { parseThroughputMultiplier, buildSolutionLayout, summarizeStrategyTrace, solvedStatusText } from '../../solutionPresentation.js';
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

const solved = { solutionPath: [], depth: 3, statesExplored: 42, solveTimeSec: '0.25' };
checkEqual('solvedStatusText: no trace → time, depth, states', solvedStatusText(solved), 'Solved in 0.25s at Depth 3 → 42 States');
checkEqual('solvedStatusText: trace → Constructive summary appended',
    solvedStatusText({ ...solved, strategyTrace: trace }),
    `Solved in 0.25s at Depth 3 → 42 States | ${summarizeStrategyTrace(trace)}`);

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
