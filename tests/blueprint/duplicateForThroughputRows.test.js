// duplicateForThroughput on rows holding several machines (idea #2785) — run with:
//   node tests/blueprint/duplicateForThroughputRows.test.js
//
// duplicateForThroughput.test.js covers one machine per row. Real paths put
// row-mates side by side (independent chains, and the Belt Split fan-out the
// Constructive planner emits for reused sub-plans), and centering each
// machine's copy group on its own x stacked those groups onto each other:
// layout fixtures overlapped from multiplier 2, CuRuSuWu:WuSuRuCu by 35 tiles.
import { buildLayout, duplicateForThroughput } from '../../blueprintLayout.js';
import { MACHINE_GAP } from '../../blueprintPositions.js';
import { LAYOUT_FIXTURES } from '../harness/layoutFixtures.js';

let passed = 0;
let total = 0;
let failed = false;

function check(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); failed = true; }
}

// Tiles covered by more than one machine footprint (x, y, floor).
function machineOverlaps(machines) {
    const owner = new Map();
    const clashes = [];
    machines.forEach((m, i) => {
        for (let dx = 0; dx < (m.def.width || 1); dx++) {
            for (let dy = 0; dy < (m.def.depth || 1); dy++) {
                for (let df = 0; df < (m.def.floors || 1); df++) {
                    const key = `${m.x + dx},${m.y + dy},${(m.floor ?? 0) + df}`;
                    if (owner.has(key)) clashes.push(`${key} ${machines[owner.get(key)].operation}/${m.operation}`);
                    else owner.set(key, i);
                }
            }
        }
    });
    return clashes;
}

const MULTIPLIERS = [2, 3, 4];

for (const { name, solutionPath } of LAYOUT_FIXTURES) {
    const layout = buildLayout(solutionPath);
    const hasSplit = solutionPath.some((s) => s.operation === 'Belt Split');
    for (const n of MULTIPLIERS) {
        const dup = duplicateForThroughput(layout, n);
        const clashes = machineOverlaps(dup.machines);
        check(`${name} ×${n}: no two machine footprints share a tile`, clashes.length === 0, clashes.slice(0, 4).join(' | '));
        check(`${name} ×${n}: machine count is ${n} × original`, dup.machines.length === n * layout.machines.length);

        // Every copy is fed on its first (offset-0) input from the splitter row
        // above it — Belt Split fan-out included, whose virtual output positions
        // belong to the original machine only.
        const beltTiles = new Set(dup.belts.map((b) => `${b.x},${b.y},${b.floor}`));
        const unfed = dup.machines.filter((m) => !beltTiles.has(`${m.x},${m.y - 1},${m.floor}`));
        check(`${name} ×${n}: every copy has a belt on its first input${hasSplit ? ' (Belt Split path)' : ''}`,
            unfed.length === 0, unfed.map((m) => `${m.operation}@${m.x},${m.y}`).join(' '));

        // Grid still contains every copy.
        const right = Math.max(...dup.machines.map((m) => m.x + (m.def.width || 1)));
        check(`${name} ×${n}: gridWidth covers every copy`, dup.gridWidth >= right);
    }
}

// Two adjacent width-1 machines in one row: at ×4 their centered groups both
// span x 0..6. Row-mates keep their left-to-right order and a MACHINE_GAP.
{
    const def = { width: 1, depth: 1, inputs: [{ side: 'back', offset: 0 }], outputs: [{ side: 'front', offset: 0 }] };
    const layout = {
        machines: [
            { operation: 'Rotator CW', x: 0, y: 2, floor: 0, def, inputShapes: ['Cu------'], outputShapes: ['-Cu-----'], params: {} },
            { operation: 'Rotator CCW', x: 1, y: 2, floor: 0, def, inputShapes: ['Ru------'], outputShapes: ['------Ru'], params: {} },
        ],
        belts: [], gridWidth: 2, gridHeight: 4, floorCount: 1,
    };
    const dup = duplicateForThroughput(layout, 4);
    const xsOf = (op) => dup.machines.filter((m) => m.operation === op).map((m) => m.x);
    const cw = xsOf('Rotator CW');
    const ccw = xsOf('Rotator CCW');
    check('adjacent row-mates ×4: Rotator CW copies at [0, 2, 4, 6]', JSON.stringify(cw) === '[0,2,4,6]', JSON.stringify(cw));
    check('adjacent row-mates ×4: Rotator CCW group starts one gap past the CW group',
        ccw[0] === cw[cw.length - 1] + 1 + MACHINE_GAP && JSON.stringify(ccw) === '[8,10,12,14]', JSON.stringify(ccw));
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
