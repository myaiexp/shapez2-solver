// Isolation pricing in the coverage heuristic (idea #6549) — run with:
//   node tests/solver/heuristicIsolate.test.js
//
// One cut removes everything on one side of a shape, across every layer, however
// many parts that is. Pricing a slot by counting conflicts charged 3 per slot for
// CuCuCuCu:RuRuRuRu → CuCu----:RuRu----, 12 in all, where one Cutter finishes, so A*
// avoided stack-then-cut routes. A slot is now priced by where the conflicts sit.
// It stays a per-slot sum: see the header of shapeSolverHeuristic.js.
import { createCoverageHeuristic } from '../../shapeSolverHeuristic.js';
import { getCachedShape } from '../../shapeSolverCache.js';
import { ShapeOperationConfig } from '../../shapeClass.js';

let passed = 0, total = 0, failed = false;
function check(name, actual, expected) {
    total++;
    if (actual === expected) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${expected}, got ${actual}`); failed = true; }
}

const config = new ShapeOperationConfig(4);
const estimate = (target, codes) => createCoverageHeuristic({
    target: getCachedShape(target), config, orientationSensitive: true, preventWaste: false, heuristicDivisor: 1,
}).unweighted(codes);

check('conflicts on one cut side cost one cut per slot, across layers',
    estimate('CuCu----:RuRu----', ['CuCuCuCu:RuRuRuRu']), 4);
check('conflicts on the other cut side cost one cut per slot too',
    estimate('----CuCu:----RuRu', ['CuCuCuCu:RuRuRuRu']), 4);
check('conflicts on a side that needs a rotation first cost two per slot',
    estimate('Cu----Cu', ['CuCuCuCu']), 4);
check('a matched part beside the conflict rules that cut out',
    estimate('Cu------', ['CuCu----']), 2);
check('conflicts on no single side cost the full isolation per slot',
    estimate('Cu--Cu--', ['CuCuCuCu']), 6);
check('a shape with no conflicts costs nothing to isolate',
    estimate('CuCu----', ['CuCu----']), 0);
check('a shape needing a rotation adds the rotation once',
    estimate('Cu------', ['--Cu----']), 1);
check('two shapes each supply their layer, plus the stack',
    estimate('CuCu----:RuRu----', ['CuCuCuCu', 'RuRuRuRu']), 4 + 1);
check('a missing part still costs a fabrication, plus the missing layer',
    estimate('Cu------', ['RuRuRuRu']), 5);

console.log(`\n${passed}/${total} passed`);
process.exit(failed ? 1 : 0);
