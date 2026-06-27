// Unit tests for routeBelt floor-transition (belt-lift) and northward-guard
// branches (audit #3720) — run with:  node tests/routeBelt.test.js
//
// blueprintRouting.js routes belts L-shaped (horizontal then vertical). Two paths
// were untested: (1) when fromFloor !== toFloor it inserts paired lift tiles and
// advances y past the lift before the southward segment; (2) when fromY > toY on
// the same floor the northward guard emits N tiles (not expected in normal layout).
// We pin exact coordinates so an off-by-one y-advance after the lift or a wrong
// guard loop bound would fail.
import { routeBelt } from '../blueprintRouting.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const SINGLE_INPUT_DEF = { inputs: [{}] };
const SHAPE = 'CuCuCuCu';

// --- floor transition: lift pair then southward segment on destination floor ----
{
    const belts = [];
    routeBelt(belts, 0, 0, 0, 0, 2, 1, SHAPE, SINGLE_INPUT_DEF, 0);

    const lifts = belts.filter(b => b.kind === 'lift');
    check('floor transition: exactly two lift tiles', lifts.length === 2);
    check('floor transition: source-floor lift at (0,0,0)',
        lifts[0].x === 0 && lifts[0].y === 0 && lifts[0].floor === 0
        && lifts[0].direction === 'S' && lifts[0].shapeCode === SHAPE);
    check('floor transition: destination-floor lift at (0,0,1)',
        lifts[1].x === 0 && lifts[1].y === 0 && lifts[1].floor === 1
        && lifts[1].direction === 'S' && lifts[1].shapeCode === SHAPE);

    const normals = belts.filter(b => b.kind === 'normal');
    check('floor transition: one southward normal tile after lift', normals.length === 1);
    check('floor transition: southward segment starts at y=1 on destination floor (not y=0)',
        normals[0].x === 0 && normals[0].y === 1 && normals[0].floor === 1
        && normals[0].direction === 'S');
    check('floor transition: no normal tile overlaps lift position on floor 1',
        !normals.some(b => b.y === 0 && b.floor === 1));
    check('floor transition: total belt count is lift pair plus one south tile',
        belts.length === 3);
}

// --- northward guard: same floor, fromY > toY ----------------------------------
{
    const fromY = 5;
    const toY = 2;
    const belts = [];
    routeBelt(belts, 0, fromY, 0, 0, toY, 0, SHAPE, SINGLE_INPUT_DEF, 0);

    const north = belts.filter(b => b.direction === 'N');
    check('northward guard: emits exactly (fromY - toY) north tiles', north.length === fromY - toY);
    check('northward guard: north tiles at y=5,4,3',
        north.length === 3
        && north[0].x === 0 && north[0].y === 5 && north[0].floor === 0
        && north[1].x === 0 && north[1].y === 4 && north[1].floor === 0
        && north[2].x === 0 && north[2].y === 3 && north[2].floor === 0);
    check('northward guard: all emitted tiles are normal (no lift)',
        belts.every(b => b.kind === 'normal'));
    check('northward guard: no lift tile produced',
        belts.every(b => b.kind !== 'lift'));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);