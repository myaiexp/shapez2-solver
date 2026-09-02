// Coverage gate: operations ↔ BUILDING_DATA must stay 1:1.
//
// placeMachines and exportBlueprintString both skip unknown ops with
// `if (!def) continue`, so a missing or null-without-Belt-Split entry
// drops the machine from the layout and the SHAPEZ2 export with no error.
// Snapshot counts then shift and get re-blessed. This file is the CI
// tripwire for that drift.
//
// Run with: node tests/blueprint/buildingDataCoverage.test.js
import { BUILDING_DATA } from '../../buildingData.js';
import { operations } from '../../shapeSolverOperations.js';

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

function checkTrue(name, cond, detail) {
    total++;
    if (cond) {
        console.log(`✓ ${name}`);
        passed++;
    } else {
        console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
        failed = true;
    }
}

/**
 * Problems that would make placeMachines / exportBlueprintString silently
 * drop a production step. Empty array = the two tables agree.
 */
function coverageProblems(ops, buildings) {
    const problems = [];
    for (const key of Object.keys(ops)) {
        if (!Object.hasOwn(buildings, key)) {
            problems.push(`operations[${JSON.stringify(key)}] has no BUILDING_DATA entry`);
        }
    }
    for (const key of Object.keys(buildings)) {
        if (!Object.hasOwn(ops, key)) {
            problems.push(`BUILDING_DATA[${JSON.stringify(key)}] is not a solver operation`);
        }
    }
    const nullKeys = Object.keys(buildings).filter(k => buildings[k] === null);
    if (nullKeys.length !== 1 || nullKeys[0] !== 'Belt Split') {
        problems.push(`Belt Split must be the only null, got ${JSON.stringify(nullKeys)}`);
    }
    for (const [key, def] of Object.entries(buildings)) {
        if (def === null) continue;
        if (typeof def.gameId !== 'string' || def.gameId.length === 0) {
            problems.push(`${key}: gameId must be a non-empty string`);
        }
        for (const dim of ['width', 'depth', 'floors']) {
            if (typeof def[dim] !== 'number' || !Number.isFinite(def[dim])) {
                problems.push(`${key}: ${dim} must be a finite number`);
            }
        }
        const inputCount = ops[key]?.inputCount;
        if (!Array.isArray(def.inputs) || def.inputs.length !== inputCount) {
            problems.push(`${key}: inputs.length ${def.inputs?.length} !== inputCount ${inputCount}`);
        }
    }
    return problems;
}

const validOps = {
    Cutter: { inputCount: 1 },
    Swapper: { inputCount: 2 },
    'Belt Split': { inputCount: 1 },
};
const validCutter = {
    gameId: 'CutterDefaultInternalVariant',
    width: 2,
    depth: 1,
    floors: 1,
    inputs: [{ side: 'back', offset: 0 }],
};
const validSwapper = {
    gameId: 'HalvesSwapperDefaultInternalVariant',
    width: 2,
    depth: 1,
    floors: 1,
    inputs: [{ side: 'back', offset: 0 }, { side: 'back', offset: 1 }],
};
const validBuildings = {
    Cutter: validCutter,
    Swapper: validSwapper,
    'Belt Split': null,
};

check('synthetic tables that agree produce no problems',
    coverageProblems(validOps, validBuildings), []);

checkTrue('missing BUILDING_DATA key is reported',
    coverageProblems(validOps, { Cutter: validCutter, 'Belt Split': null })
        .some(p => p.includes('Swapper') && p.includes('no BUILDING_DATA')),
    'expected a missing-Swapper problem');

checkTrue('extra BUILDING_DATA key is reported',
    coverageProblems(validOps, { ...validBuildings, Extra: validCutter })
        .some(p => p.includes('Extra') && p.includes('not a solver operation')),
    'expected an extra-key problem');

checkTrue('empty gameId is reported',
    coverageProblems(validOps, { ...validBuildings, Cutter: { ...validCutter, gameId: '' } })
        .some(p => p.includes('Cutter') && p.includes('gameId')),
    'expected an empty-gameId problem');

checkTrue('non-numeric width is reported',
    coverageProblems(validOps, { ...validBuildings, Cutter: { ...validCutter, width: '2' } })
        .some(p => p.includes('Cutter') && p.includes('width')),
    'expected a non-numeric-width problem');

checkTrue('inputCount drift is reported',
    coverageProblems(validOps, { ...validBuildings, Swapper: { ...validSwapper, inputs: validCutter.inputs } })
        .some(p => p.includes('Swapper') && p.includes('inputCount')),
    'expected an inputCount mismatch');

checkTrue('a second null is reported',
    coverageProblems(validOps, { ...validBuildings, Cutter: null })
        .some(p => p.includes('only null')),
    'expected Belt Split to be the only allowed null');

checkTrue('nulling Belt Split away is reported',
    coverageProblems(validOps, { ...validBuildings, 'Belt Split': validCutter })
        .some(p => p.includes('only null')),
    'expected Belt Split to remain the sole null');

// Live tables — the actual CI tripwire.
const live = coverageProblems(operations, BUILDING_DATA);
check('live operations ↔ BUILDING_DATA agree', live, []);

for (const key of Object.keys(operations)) {
    checkTrue(`${key} is in BUILDING_DATA`, Object.hasOwn(BUILDING_DATA, key));
}
for (const key of Object.keys(BUILDING_DATA)) {
    checkTrue(`${key} is in operations`, Object.hasOwn(operations, key));
}

const nullKeys = Object.keys(BUILDING_DATA).filter(k => BUILDING_DATA[k] === null);
check('Belt Split is the only null BUILDING_DATA entry', nullKeys, ['Belt Split']);

for (const [key, def] of Object.entries(BUILDING_DATA)) {
    if (def === null) continue;
    checkTrue(`${key} gameId is a non-empty string`,
        typeof def.gameId === 'string' && def.gameId.length > 0);
    checkTrue(`${key} width is a finite number`, Number.isFinite(def.width));
    checkTrue(`${key} depth is a finite number`, Number.isFinite(def.depth));
    checkTrue(`${key} floors is a finite number`, Number.isFinite(def.floors));
    check(`${key} inputs.length === operations.inputCount`,
        def.inputs.length, operations[key].inputCount);
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
