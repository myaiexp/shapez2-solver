// Unit tests for pathInventory.acceptableCodes — run with:
//   node tests/shared/pathInventory.test.js
//
// Core search and Constructive both treat this set as 'the target' (exact match
// vs every rotation). Pinning the helper — including the optional pre-parsed
// Shape so the solver cache is not re-parsed — is what keeps those two plus
// the harness gates from drifting.
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { getAllRotations } from '../../shapeRotation.js';
import { acceptableCodes } from '../../pathInventory.js';

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

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
