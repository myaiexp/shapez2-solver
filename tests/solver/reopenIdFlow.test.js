// A*/Bidirectional re-opens and the id flow of the path — run with:
//   node tests/solver/reopenIdFlow.test.js
//
// runBestFirst re-opens a state when it finds a cheaper route, and that mints
// new ids for the state's shapes. Children expanded before the re-open still
// consume the old ids, so a goal popped under them reconstructs a path whose
// steps name ids no step produced (an extra source belt in the factory), with
// `depth` still holding the abandoned route's cost.
//
// That needs a child to pop before the re-opened state. The re-opened copy has
// a lower g, so with h a pure function of the state it has a lower f than the
// original, and the queue pops it first. The hole was h reading held shapes in
// id order: neededPieces' greedy cover counted the same held set as 2 or 3
// pieces depending on which route built it.
//
// The fixture forces that race through the real heuristic and queue. Only the
// ops are synthetic, because fuzzing real ops never reached it (~350k dequeues,
// ~1,850 solved paths). With a = CuCu----, b = ----CuCu, c = --CuCu--:
//
//   slow: a+x -> a+b+j1 -> ... -> a+b+j9 -> a+b+c   g=10, h=10, f=20 (c held last)
//   fast: a+x -> a+w -> a+c+b                       g=2,  h=20, f=22 (c held first)
//
// S = a+b+c pops at f=20 and pushes its child C at f=21. a+w also sits at 21 and
// is older, so it pops first and re-opens S at f=22, above C. C pops next, under
// a chain that now runs through the fast route.
//
// Either half of the fix passes this file's fixture alone: order-independent h
// closes the race, and rebindChainInputs (tests/solver/pathInventory.test.js)
// repairs the ids if it ever opens again.
import { shapeSolver } from '../../shapeSolverCore.js';
import { operations } from '../../shapeSolverOperations.js';
import { createCoverageHeuristic } from '../../shapeSolverHeuristic.js';
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { invalidPathIds, pathReachesTarget } from '../harness/pathValidation.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

const config = new ShapeOperationConfig(4);
const TARGET = 'CuCuCuCu';
const [A, B, C] = ['CuCu----', '----CuCu', '--CuCu--'];

// --- h is a function of the held multiset ------------------------------------
{
    const PIECES = [A, B, C, 'Cu----Cu', 'Cu--Cu--', '--Cu--Cu', 'Cu------', '--Cu----',
        '----Cu--', '------Cu', 'CuCuCu--', '--CuCuCu', 'SuCuSuCu', 'RuRu----'];
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >> 8) % n; };
    const shuffled = (list) => {
        const out = [...list];
        for (let i = out.length - 1; i > 0; i--) {
            const j = rnd(i + 1);
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
    };

    for (const orientationSensitive of [true, false]) {
        const heuristic = createCoverageHeuristic({
            target: Shape.fromShapeCode(TARGET), config, orientationSensitive,
            preventWaste: false, heuristicDivisor: 1,
        });
        let mismatch = null;
        for (let round = 0; round < 500 && !mismatch; round++) {
            const held = Array.from({ length: 2 + rnd(5) }, () => PIECES[rnd(PIECES.length)]);
            const expected = heuristic(held);
            for (let order = 0; order < 8 && !mismatch; order++) {
                const reordered = shuffled(held);
                if (heuristic(reordered) !== expected) mismatch = `${held} -> ${expected}, ${reordered} -> ${heuristic(reordered)}`;
            }
        }
        check(`h ignores held order (orientationSensitive=${orientationSensitive})`, mismatch === null, mismatch);
    }
}

// --- the re-open race, end to end ---------------------------------------------
{
    const X = 'SuSuSuSu';
    const W = 'RuRuRuRu';
    const K = 'WuWuWuWu';
    const J = ['SuRuSuRu', 'SuWuSuWu', 'RuWuRuWu', 'SuSuRuRu', 'SuSuWuWu', 'RuRuWuWu', 'SuRuWuRu', 'RuSuWuSu', 'WuSuRuSu'];

    const forward = new Map([[X, [B, J[0]]], [W, [C, B]], [J[8], [C]], [C, [K]], [K, [TARGET]]]);
    J.slice(0, -1).forEach((code, i) => forward.set(code, [J[i + 1]]));
    const tableOp = (table) => ({
        inputCount: 1,
        fn: (shape) => (table.get(shape.toShapeCode()) ?? []).map((code) => Shape.fromShapeCode(code)),
    });
    operations['Fixture Forward'] = tableOp(forward);
    operations['Fixture Branch'] = tableOp(new Map([[X, [W]]]));

    const starts = [A, X];
    for (const searchMethod of ['A*', 'Bidirectional']) {
        const res = await shapeSolver(TARGET, starts, ['Fixture Forward', 'Fixture Branch'], {
            searchMethod, orientationSensitive: true, maxStates: 1000,
        });
        const path = res?.solutionPath;
        check(`${searchMethod}: solves on the fast route`, path?.length === 4, `got ${path?.length}`);
        const badIds = invalidPathIds(path, { starts });
        check(`${searchMethod}: every consumed id is held when consumed`, badIds.length === 0, badIds.join(' | '));
        check(`${searchMethod}: depth is the path's length`, res?.depth === path?.length, `depth ${res?.depth}, path ${path?.length}`);
        check(`${searchMethod}: the final hand holds the target`,
            pathReachesTarget(path, TARGET, { starts, config, orientationSensitive: true }));
    }
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
