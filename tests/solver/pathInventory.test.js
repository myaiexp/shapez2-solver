// Unit tests for pathInventory's acceptableCodes and rebindChainInputs — run with:
//   node tests/solver/pathInventory.test.js
//
// Core search and Constructive both treat acceptableCodes as 'the target' (exact
// match vs every rotation). Pinning the helper — including the optional pre-parsed
// Shape so the solver cache is not re-parsed — is what keeps those two plus
// the harness gates from drifting.
//
// rebindChainInputs is tested on hand-built chains: order-independent h keeps
// a stale chain out of real solves, so no solve can reach the rebinding
// (tests/solver/reopenIdFlow.test.js has the history).
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { getAllRotations } from '../../shapeRotation.js';
import { acceptableCodes, rebindChainInputs } from '../../pathInventory.js';

const cfg = new ShapeOperationConfig(4);

let passed = 0, total = 0, failed = false;
function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

const setEq = (a, b) => {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
};

check('acceptableCodes: orientation-sensitive is a singleton of the code',
    setEq(acceptableCodes('CuRuSuWu', { orientationSensitive: true, config: cfg }),
        new Set(['CuRuSuWu'])));

const parsed = Shape.fromShapeCode('CuRuSuWu');
const fromRotations = new Set(getAllRotations(parsed, cfg));
check('acceptableCodes: default set is every rotation of the target',
    setEq(acceptableCodes('CuRuSuWu', { config: cfg }), fromRotations));

// Optional `shape` is the solver-cache path: pass the already-parsed target
// instead of Shape.fromShapeCode(code). A different Shape than the code string
// must win — otherwise callers cannot trust the cache and will keep hand-rolling.
check('acceptableCodes: provided shape is used instead of re-parsing the code',
    setEq(acceptableCodes('CuRuSuWu', { config: cfg, shape: Shape.fromShapeCode('SuSuSuSu') }),
        new Set(['SuSuSuSu'])));

check('acceptableCodes: provided shape matching the code agrees with parse-from-code',
    setEq(acceptableCodes('CuRuSuWu', { config: cfg, shape: parsed }),
        acceptableCodes('CuRuSuWu', { config: cfg })));

// --- rebindChainInputs ---------------------------------------------------------
const CODES = { 0: 'x', 1: 'y', 5: 'c', 6: 'b', 7: 'c', 8: 'k', 9: 'z', 13: 'c', 14: 'c' };
const codeOf = (id) => CODES[id];
const chainStep = (inputIds, outputIds) => ({ type: 'Op', inputIds, outputIds, color: null });
const inputsOf = (steps) => JSON.stringify(steps.map((s) => s.inputIds));

// A chain with no stale id must come back as it went in, even where two ids
// hold one code: BFS and every ordinary A* path pass through here.
{
    const steps = [chainStep([0], [5, 7]), chainStep([7], [8]), chainStep([5, 1], [9])];
    check('rebindChainInputs: a consistent chain keeps its own ids',
        inputsOf(rebindChainInputs(steps, [0, 1], codeOf)) === '[[0],[7],[5,1]]');
}

// Id 13 (code c) belongs to a route the chain no longer runs through.
{
    const steps = [chainStep([0], [5, 6]), chainStep([13], [8])];
    const rebound = rebindChainInputs(steps, [0], codeOf);
    check('rebindChainInputs: a stale id becomes the held id of its code',
        inputsOf(rebound) === '[[0],[5]]', inputsOf(rebound));
    check('rebindChainInputs: output ids are untouched',
        JSON.stringify(rebound.map((s) => s.outputIds)) === '[[5,6],[8]]');
    check('rebindChainInputs: the input steps are not mutated', inputsOf(steps) === '[[0],[13]]');
}

check('rebindChainInputs: two stale inputs of one code take different ids',
    inputsOf(rebindChainInputs([chainStep([0], [5, 7]), chainStep([13, 14], [8])], [0], codeOf)) === '[[0],[5,7]]');

// The stale id takes 5, so the later step naming 5 must fall back to 7 rather
// than consume 5 twice.
check('rebindChainInputs: a step whose own id was taken uses the other held id',
    inputsOf(rebindChainInputs([chainStep([0], [5, 7]), chainStep([13], [8]), chainStep([5], [9])], [0], codeOf)) === '[[0],[5],[7]]');

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
