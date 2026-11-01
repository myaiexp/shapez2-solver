// Unit tests for routeBelt's floor transition (belt lift), merge tile and
// never-north contract (audit #3720) — run with:
// node tests/blueprint/routeBelt.test.js
//
// blueprintRouting.js routes belts L-shaped (horizontal then vertical). When the
// floors differ it inserts paired lift tiles and advances y past the lift before
// the southward segment. A route whose start lies south of the machine's back
// face is a layout bug and throws: a north belt would enter the machine through
// its output side. We pin exact coordinates so an off-by-one y-advance after the
// lift would fail.
import { routeBelt } from '../../blueprintRouting.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}`); failed = true; }
}

const SHAPE = 'CuCuCuCu';

function route(belts, from, to, isMerge = false) {
    routeBelt(belts, { from, to, shapeCode: SHAPE, isMerge });
}

function throwsWithoutTiles(from, to) {
    const belts = [];
    try {
        route(belts, from, to);
    } catch {
        return belts.length === 0;
    }
    return false;
}

// --- floor transition: lift pair then southward segment on destination floor ----
{
    const belts = [];
    route(belts, { x: 0, y: 0, floor: 0 }, { x: 0, y: 2, floor: 1 });

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

// --- merge input: a merge tile just above the back face, on the input's floor ---
{
    const belts = [];
    route(belts, { x: 0, y: 0, floor: 0 }, { x: 1, y: 3, floor: 1 }, true);
    const merges = belts.filter(b => b.kind === 'merge');
    check('merge: exactly one merge tile', merges.length === 1);
    check('merge: tile at (1,2,1) heading south',
        merges[0].x === 1 && merges[0].y === 2 && merges[0].floor === 1
        && merges[0].direction === 'S' && merges[0].shapeCode === SHAPE);

    const plain = [];
    route(plain, { x: 0, y: 0, floor: 0 }, { x: 1, y: 3, floor: 1 });
    check('merge: no merge tile on a non-merge input', plain.every(b => b.kind !== 'merge'));
}

// --- never north: a route that would have to reverse throws, leaving no tiles ---
check('never north: start south of the back face throws',
    throwsWithoutTiles({ x: 0, y: 5, floor: 0 }, { x: 0, y: 2, floor: 0 }));
check('never north: a lift that lands past the back face throws',
    throwsWithoutTiles({ x: 0, y: 4, floor: 0 }, { x: 0, y: 4, floor: 1 }));
{
    const belts = [];
    route(belts, { x: 0, y: 4, floor: 0 }, { x: 3, y: 4, floor: 0 });
    check('never north: a same-row route is still allowed',
        belts.length === 3 && belts.every(b => b.direction === 'E'));
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);