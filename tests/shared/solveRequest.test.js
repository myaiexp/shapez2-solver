// Solve / Explore worker payloads (audit #12023) — run with:
//   node tests/shared/solveRequest.test.js
//
// main.js used to build these objects inline, so a edit that sent maxStates
// or dropped nodeBudget passed the suite. The shared budget box is one number
// in two fields, and the browser does not send the global maxStates ceiling.
import { buildSolveRequest, buildExploreRequest } from '../../solveRequest.js';
import { MAX_EXPLORE_DEPTH, DEFAULT_EXPLORE_DEPTH } from '../../exploreDepth.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

function checkEqual(name, actual, expected) {
    total++;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}\n    expected: ${e}\n    actual:   ${a}`); failed = true; }
}

const base = {
    targetShapeCode: 'CuCu----',
    startingShapeCodes: ['CuCuCuCu', 'RuRuRuRu', 'WuWuWuWu'],
    enabledOperations: ['Cutter'],
    maxLayers: 6,
    budget: 2500,
    preventWaste: true,
    orientationSensitive: false,
    monolayerPainting: true,
    heuristicDivisor: 0.5,
    searchMethod: 'Constructive',
    filterUnusedShapes: true,
};

{
    const { request, filteredOut } = buildSolveRequest(base);
    checkEqual('solve: unused colors are filtered before the payload', request.startingShapeCodes, ['CuCuCuCu']);
    checkEqual('solve: filteredOut counts the dropped starts', filteredOut, 2);
    checkEqual('solve: budget lands in both per-level and per-node fields',
        [request.maxStatesPerLevel, request.nodeBudget], [2500, 2500]);
    check('solve: maxStates is absent (browser ceiling stays uncapped)', !Object.hasOwn(request, 'maxStates'));
    checkEqual('solve: layers, heuristic, method and flags pass through',
        [request.maxLayers, request.heuristicDivisor, request.searchMethod, request.preventWaste, request.monolayerPainting, request.targetShapeCode],
        [6, 0.5, 'Constructive', true, true, 'CuCu----']);
}

{
    const { request, filteredOut } = buildSolveRequest({ ...base, filterUnusedShapes: false });
    checkEqual('solve: filter off keeps every start', request.startingShapeCodes, base.startingShapeCodes);
    checkEqual('solve: filter off drops nothing', filteredOut, 0);
    check('solve: filter off still omits maxStates', !Object.hasOwn(request, 'maxStates'));
}

{
    const { request } = buildSolveRequest({
        ...base,
        targetShapeCode: 'SuSuSuSu',
        startingShapeCodes: ['CuCuCuCu'],
    });
    checkEqual('solve: a filter that matches nothing yields an empty start list', request.startingShapeCodes, []);
}

{
    const request = buildExploreRequest({
        startingShapeCodes: ['CuCuCuCu'],
        enabledOperations: ['Cutter', 'Painter'],
        depthLimit: '999',
        maxLayers: 3,
        targetShapeCode: '  CrCrCrCr  ',
    });
    checkEqual('explore: target is trimmed and forwarded', request.targetShapeCode, 'CrCrCrCr');
    checkEqual('explore: depth 999 clamps to the UI max', request.depthLimit, MAX_EXPLORE_DEPTH);
    checkEqual('explore: maxLayers passes through', request.maxLayers, 3);
    checkEqual('explore: starts and ops pass through',
        [request.startingShapeCodes, request.enabledOperations],
        [['CuCuCuCu'], ['Cutter', 'Painter']]);
    check('explore: no solve budgets on an explore payload',
        !Object.hasOwn(request, 'maxStates') && !Object.hasOwn(request, 'nodeBudget') && !Object.hasOwn(request, 'maxStatesPerLevel'));
}

{
    const blank = buildExploreRequest({
        startingShapeCodes: [],
        enabledOperations: [],
        depthLimit: '',
        maxLayers: 4,
        targetShapeCode: '   ',
    });
    checkEqual('explore: blank target is null', blank.targetShapeCode, null);
    checkEqual('explore: blank depth is the default', blank.depthLimit, DEFAULT_EXPLORE_DEPTH);
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
