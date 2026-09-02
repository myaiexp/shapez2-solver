// Contract tests for operationResultCache keys. Run with:
//   node tests/solver/shapeSolverCache.test.js
//
// getCachedUnaryResult / getCachedColoredUnaryResult / getCachedBinaryResult
// must include config.maxShapeLayers in the key. Pin Pusher and Stacker both
// drop overflow layers, so the same op+code under two caps must not return
// each other's result. A key of only op|code would hand a maxLayers-4 stack
// back to a maxLayers-2 caller.
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { pushPin, stack, genCrystal } from '../../shapeOperations.js';
import {
    operationResultCache,
    getCachedUnaryResult,
    getCachedColoredUnaryResult,
    getCachedBinaryResult,
} from '../../shapeSolverCache.js';

let passed = 0, total = 0, failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed = true; }
}

const codes = shapes => (shapes ?? []).map(s => s.toShapeCode());
const shape = code => Shape.fromShapeCode(code);
const cap = n => new ShapeOperationConfig(n);

function counting(fn) {
    const wrapped = (...args) => { wrapped.calls++; return fn(...args); };
    wrapped.calls = 0;
    return wrapped;
}

// --- Pin Pusher (unary, layer-cap sensitive) --------------------------------

{
    operationResultCache.clear();
    const input = shape('CuCuCuCu:RuRuRuRu');
    const counted = counting(pushPin);
    const at4 = codes(getCachedUnaryResult('Pin Pusher', counted, input, cap(4)));
    const at2 = codes(getCachedUnaryResult('Pin Pusher', counted, input, cap(2)));
    check('Pin Pusher maxLayers 4 keeps three layers', at4, ['P-P-P-P-:CuCuCuCu:RuRuRuRu']);
    check('Pin Pusher maxLayers 2 drops the overflow layer', at2, ['P-P-P-P-:CuCuCuCu']);
    check('Pin Pusher: two caps are two cache entries (fn called twice)', counted.calls, 2);
    check('Pin Pusher: same cap 4 hits the cache',
        codes(getCachedUnaryResult('Pin Pusher', counted, input, cap(4))), at4);
    check('Pin Pusher: cache hit does not re-call fn', counted.calls, 2);
}

// --- Stacker (binary, layer-cap sensitive) ----------------------------------

{
    operationResultCache.clear();
    const bottom = shape('CuCuCuCu:RuRuRuRu');
    const top = shape('SuSuSuSu');
    const counted = counting(stack);
    const at4 = codes(getCachedBinaryResult('Stacker', counted, bottom, top, cap(4)));
    const at2 = codes(getCachedBinaryResult('Stacker', counted, bottom, top, cap(2)));
    check('Stacker maxLayers 4 keeps three layers', at4, ['CuCuCuCu:RuRuRuRu:SuSuSuSu']);
    check('Stacker maxLayers 2 truncates to two layers', at2, ['CuCuCuCu:RuRuRuRu']);
    check('Stacker: two caps are two cache entries (fn called twice)', counted.calls, 2);
    check('Stacker: same cap 4 hits the cache',
        codes(getCachedBinaryResult('Stacker', counted, bottom, top, cap(4))), at4);
    check('Stacker: cache hit does not re-call fn', counted.calls, 2);
}

// --- Crystal Generator (colored unary): cap is still part of the key --------
// genCrystal ignores maxLayers, so the *result* is the same — but a later
// caller with a different cap must still miss the other cap's entry (the fn
// is invoked again) rather than sharing a cap-blind slot.

{
    operationResultCache.clear();
    const input = shape('P-P-P-P-');
    const counted = counting(genCrystal);
    const at4 = codes(getCachedColoredUnaryResult('Crystal Generator', counted, input, 'r', cap(4)));
    const at2 = codes(getCachedColoredUnaryResult('Crystal Generator', counted, input, 'r', cap(2)));
    check('Crystal Generator result is cap-independent', at4, ['crcrcrcr']);
    check('Crystal Generator same result under cap 2', at2, at4);
    check('Crystal Generator: two caps still miss each other (fn called twice)', counted.calls, 2);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
