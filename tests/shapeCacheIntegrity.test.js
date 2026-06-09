// Regression tests: shape operations must NOT mutate their input Shape objects.
// The solver shares parsed shapes via a cache (getCachedShape), so any in-place
// mutation of an input corrupts every later read of that shape and produces
// impossible solution paths (e.g. "Crystal Generator: SuSuSuSu -> cucucucu",
// "Rotator CW: CuCuRuRu -> Ru----Ru"). The original culprit was stack(), which
// spread the inputs' layer arrays into _makeLayersFall — a function that mutates
// its argument in place. Run with: node tests/shapeCacheIntegrity.test.js
import { Shape } from '../shapeClass.js';
import { cut, halfCut, stack, swapHalves, topPaint, pushPin, genCrystal, rotate90CW } from '../shapeOperations.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        failed = true;
    }
}

const s = code => Shape.fromShapeCode(code);

// Each entry: apply `run(a, b)` and assert neither input's code changed afterward.
// `b` is only used by 2-input ops.
const cases = [
    ['cut keeps input intact',        a => cut(a),                       'CuCuRuRu', null],
    ['halfCut keeps input intact',    a => halfCut(a),                   'CuCuRuRu', null],
    ['topPaint keeps input intact',   a => topPaint(a, 'r'),             'CuCuRuRu', null],
    ['pushPin keeps input intact',    a => pushPin(a),                   'CuCuRuRu', null],
    ['genCrystal keeps input intact', a => genCrystal(a, 'r'),           'P-P-P-P-', null],
    ['rotate90CW keeps input intact', a => rotate90CW(a),                'CuRuSuWu', null],
    // 2-input ops — the regression cases. The bottom is half-empty so gravity in
    // stack() makes the top group fall, which is exactly what reassigns layer
    // slots inside _makeLayersFall.
    ['stack keeps bottom intact',     (a, b) => stack(a, b),             'CuCu----', 'SuSuSuSu'],
    ['stack keeps top intact (falls)',(a, b) => stack(b, a),             'SuSuSuSu', 'CuCu----'],
    ['swapHalves keeps inputs intact',(a, b) => swapHalves(a, b),        'CuCuCuCu', 'RuRuRuRu'],
];

for (const [name, run, codeA, codeB] of cases) {
    const a = s(codeA);
    const b = codeB ? s(codeB) : null;
    run(a, b);
    check(name + ' (A)', a.toShapeCode(), codeA);
    if (b) check(name + ' (B)', b.toShapeCode(), codeB);
}

// The exact corruption the bug produced: stacking a shape onto a half-empty
// bottom must NOT turn the stacked shape into all-nothing.
const top = s('SuSuSuSu');
const out = stack(s('CuCu----'), top);
check('stack(CuCu----, SuSuSuSu) output is correct', out[0].toShapeCode(), 'CuCu----:SuSuSuSu');
check('stacked SuSuSuSu is not corrupted to --------', top.toShapeCode(), 'SuSuSuSu');

// A shared shape passed through several ops stays the original. This mirrors the
// solver reusing one cached Shape instance across many operation attempts.
const shared = s('CuCuRuRu');
stack(s('CuCu----'), shared);
swapHalves(shared, s('SuSuSuSu'));
cut(shared);
check('shared shape survives stack+swap+cut', shared.toShapeCode(), 'CuCuRuRu');

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
