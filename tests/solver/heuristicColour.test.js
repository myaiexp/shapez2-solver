// Colour pricing in the coverage heuristic (idea #7003) — run with:
//   node tests/solver/heuristicColour.test.js
//
// The heuristic matched on part shape only, so a state holding the uncoloured
// structure of a painted target scored as solved and every colour variant tied:
// CrCrCrCr:RgRgRgRg flooded A* to the state cap while BFS found it in 3 ops.
// Each target colour no held shape supplies in place now costs one Painter op,
// charged once per colour however many slots carry it.
import { createCoverageHeuristic } from '../../shapeSolverHeuristic.js';
import { getCachedShape } from '../../shapeSolverCache.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import { shapeSolver } from '../../shapeSolverCore.js';
import { operations } from '../../shapeSolverOperations.js';

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

check('the right colour costs nothing', estimate('CrCrCrCr', ['CrCrCrCr']), 0);
check('an uncoloured copy of a painted target costs one Painter op', estimate('CrCrCrCr', ['CuCuCuCu']), 1);
check('a wrong colour costs the same Painter op', estimate('CrCrCrCr', ['CgCgCgCg']), 1);
check('each missing colour is charged once, however many slots carry it',
    estimate('CrCrRgRg', ['CuCuRuRu']), 2);
check('a colour a held shape already supplies in place is not charged',
    estimate('CrCrCrCr:RgRgRgRg', ['CrCrCrCr', 'RuRuRuRu']), 1 + 1);
check('four colours on one layer cost four Painter ops',
    estimate('CrRgSbWy', ['CuRuSuWu']), 4);
check('an uncoloured target slot is never charged paint', estimate('CuCuCuCu', ['CuCuCuCu']), 0);
// A Painter colours only the top layer, and nothing removes paint. A part whose
// colour no Painter can reach is no supply: crediting it made stacking first
// (CuCuCuCu:RuRuRuRu, every slot "matched") look one paint from done.
check('a wrong colour below the top layer is a conflict, not a supply',
    estimate('CrCrCrCr:RgRgRgRg', ['CuCuCuCu:RgRgRgRg']) > estimate('CrCrCrCr:RgRgRgRg', ['CuCuCuCu', 'RgRgRgRg']), true);
check('the separate layers still cost one stack plus the missing colour',
    estimate('CrCrCrCr:RgRgRgRg', ['CuCuCuCu', 'RgRgRgRg']), 1 + 1);
check('a painted part cannot supply an uncoloured target slot',
    estimate('CuCuCuCu', ['CrCrCrCr']) > 0, true);
check('a pin has no colour to charge', estimate('P-P-P-P-:CrCrCrCr', ['P-P-P-P-:CrCrCrCr']), 0);

// End to end: default starts and ops, the browser-like weighted A*.
{
    const result = await shapeSolver('CrCrCrCr:RgRgRgRg', ['CuCuCuCu', 'RuRuRuRu', 'SuSuSuSu', 'WuWuWuWu'],
        Object.keys(operations), { searchMethod: 'A*', maxStates: 20000 });
    check('A* solves CrCrCrCr:RgRgRgRg inside 20k states', result.solutionPath !== null, true);
}

console.log(`\n${passed}/${total} passed`);
process.exit(failed ? 1 : 0);
