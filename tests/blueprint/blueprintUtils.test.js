// Unit tests for computeGridBounds — run with: node tests/blueprint/blueprintUtils.test.js
import { computeGridBounds } from '../../blueprintUtils.js';

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

// Empty input, default seeds → origin.
check('empty machines + belts, default seeds',
    computeGridBounds([], []),
    { gridWidth: 0, gridHeight: 0 });

// Empty input passes the seeds straight through.
check('empty input seeds pass through',
    computeGridBounds([], [], 5, 3),
    { gridWidth: 5, gridHeight: 3 });

// Single machine: right = x + width, bottom = y + depth.
check('single machine',
    computeGridBounds([{ x: 2, y: 3, def: { width: 4, depth: 2 } }], []),
    { gridWidth: 6, gridHeight: 5 });

// Machine with no def falls back to a 1x1 footprint (optional-chaining path).
check('machine without def → 1x1 footprint',
    computeGridBounds([{ x: 1, y: 1 }], []),
    { gridWidth: 2, gridHeight: 2 });

// Zero/absent width/depth coerce to 1 via `|| 1`.
check('def with zero width/depth → 1x1',
    computeGridBounds([{ x: 5, y: 0, def: { width: 0, depth: 0 } }], []),
    { gridWidth: 6, gridHeight: 1 });

// Belts only: right = x + 1, bottom = y + 1.
check('belts only',
    computeGridBounds([], [{ x: 3, y: 5 }]),
    { gridWidth: 4, gridHeight: 6 });

// Max-bounds combination: width and height each come from a different entity.
check('machines + belts, max bounds across both',
    computeGridBounds(
        [{ x: 2, y: 2, def: { width: 3, depth: 3 } }],
        [{ x: 7, y: 1 }, { x: 0, y: 9 }]
    ),
    { gridWidth: 8, gridHeight: 10 });

// A seed larger than every entity dominates the result.
check('seed dominates computed bounds',
    computeGridBounds(
        [{ x: 0, y: 0, def: { width: 1, depth: 1 } }],
        [{ x: 1, y: 1 }],
        20, 30
    ),
    { gridWidth: 20, gridHeight: 30 });

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
