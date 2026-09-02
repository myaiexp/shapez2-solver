// Unit tests for layout collision counters used by smoke layout snapshots.
// Run with: node tests/shared/layoutCollisions.test.js
import { overlappingBeltTiles, beltsOverMachineFootprint } from './layoutCollisions.js';

let passed = 0, total = 0, failed = false;

function check(name, actual, expected) {
    total++;
    const match = JSON.stringify(actual) === JSON.stringify(expected);
    if (match) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); failed = true; }
}

const belt = (x, y, floor = 0) => ({ x, y, floor });
const machine = (x, y, width, depth, floor = 0, floors = 1) => ({
    x, y, floor, def: { width, depth, floors },
});

check('no belts → 0 overlapping tiles', overlappingBeltTiles([]), 0);
check('distinct tiles do not overlap', overlappingBeltTiles([belt(0, 0), belt(1, 0), belt(0, 1)]), 0);
check('same (x,y) on different floors do not overlap', overlappingBeltTiles([belt(0, 0, 0), belt(0, 0, 1)]), 0);
check('two belts on one tile → 1 overlapping position', overlappingBeltTiles([belt(2, 3), belt(2, 3)]), 1);
check('three belts on one tile still count as 1 position', overlappingBeltTiles([belt(1, 1), belt(1, 1), belt(1, 1)]), 1);
check('two duplicated positions → 2', overlappingBeltTiles([
    belt(0, 0), belt(0, 0),
    belt(5, 5), belt(5, 5),
    belt(1, 2),
]), 2);

check('no belts over empty machines', beltsOverMachineFootprint([], [machine(0, 0, 2, 1)]), 0);
check('belt outside 2x1 footprint is not over the machine',
    beltsOverMachineFootprint([belt(2, 0), belt(0, 1), belt(1, -1)], [machine(0, 0, 2, 1)]), 0);
check('belt on the machine tile is over the footprint',
    beltsOverMachineFootprint([belt(0, 0), belt(1, 0)], [machine(0, 0, 2, 1)]), 2);
check('two belts on the same machine tile count as 1 position',
    beltsOverMachineFootprint([belt(0, 0), belt(0, 0)], [machine(0, 0, 1, 1)]), 1);
check('belt on a stacker upper floor is over the footprint',
    beltsOverMachineFootprint([belt(0, 0, 1)], [machine(0, 0, 1, 1, 0, 2)]), 1);
check('belt on a floor the machine does not occupy is not over it',
    beltsOverMachineFootprint([belt(0, 0, 1)], [machine(0, 0, 1, 1, 0, 1)]), 0);
check('machine without def falls back to 1x1 on its floor',
    beltsOverMachineFootprint([belt(4, 5)], [{ x: 4, y: 5, floor: 0 }]), 1);

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
