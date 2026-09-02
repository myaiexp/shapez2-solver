// Unit tests for buildBackwardReachability (finding #8618) — run with:
//   node tests/solver/shapeSolverBackward.test.js
//
// Bidirectional search consumes this map as its backward half. Smoke's two
// Bidirectional fixtures are shallow enough that forward A* would still find
// them if the map silently returned only {target: 0}, so the map itself needs
// its own contract: target at depth 0, invertible ops produce depth-1
// predecessors, unmapped ops take the inverseOps.length === 0 early return,
// and shouldCancel stops expansion.
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { rotate90CCW } from '../../shapeRotation.js';
import { buildBackwardReachability } from '../../shapeSolverBackward.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const cfg = new ShapeOperationConfig(4);
const TARGET = 'CuRuSuWu';
const noCancel = () => false;

function asObj(map) {
    return Object.fromEntries(map);
}

// --- Target is always depth 0 ------------------------------------------------
{
    const map = buildBackwardReachability(TARGET, cfg, ['Rotator CW'], 1, noCancel);
    check('rot-cw: map contains the target', map.has(TARGET));
    check('rot-cw: target is depth 0', map.get(TARGET) === 0);
}

// --- Rotator CW only: exactly the CCW predecessor at depth 1 -----------------
{
    const map = buildBackwardReachability(TARGET, cfg, ['Rotator CW'], 1, noCancel);
    const pred = rotate90CCW(Shape.fromShapeCode(TARGET))[0].toShapeCode();
    check('rot-cw depth1: predecessor is rotate90CCW(target)', map.get(pred) === 1);
    check('rot-cw depth1: map is exactly {target:0, pred:1}',
        map.size === 2 && map.get(TARGET) === 0 && map.get(pred) === 1);
}

// --- Painter: inverseUnpaint predecessor at depth 1 --------------------------
{
    const painted = 'CrCrCrCr';
    const map = buildBackwardReachability(painted, cfg, ['Painter'], 1, noCancel);
    check('painter depth1: unpainted code is the depth-1 predecessor',
        map.get('CuCuCuCu') === 1);
    check('painter depth1: map is exactly {painted:0, unpainted:1}',
        map.size === 2 && map.get(painted) === 0 && map.get('CuCuCuCu') === 1);
}

// --- Unmapped op set (Trash is not invertible): singleton via early return ---
{
    const map = buildBackwardReachability(TARGET, cfg, ['Trash'], 4, noCancel);
    check('trash-only: singleton map', map.size === 1);
    check('trash-only: the one entry is the target at depth 0',
        map.get(TARGET) === 0);
    check('trash-only: empty enabled list is the same singleton',
        JSON.stringify(asObj(buildBackwardReachability(TARGET, cfg, [], 4, noCancel)))
        === JSON.stringify({ [TARGET]: 0 }));
}

// --- shouldCancel stops expansion --------------------------------------------
{
    const always = buildBackwardReachability(TARGET, cfg, ['Rotator CW'], 4, () => true);
    check('always-cancel: no expansion past the target', always.size === 1);
    check('always-cancel: target still at depth 0', always.get(TARGET) === 0);

    let calls = 0;
    const afterFirstDepth = () => ++calls > 1;
    const partial = buildBackwardReachability(TARGET, cfg, ['Rotator CW'], 4, afterFirstDepth);
    const depths = [...partial.values()];
    check('cancel-after-depth1: expanded exactly one inverse step',
        Math.max(...depths) === 1);
    check('cancel-after-depth1: did not reach depth 2+',
        depths.every(d => d <= 1));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
