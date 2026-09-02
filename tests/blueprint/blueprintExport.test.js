// Unit tests for exportBlueprintString — run with:
//   node tests/blueprint/blueprintExport.test.js
//
// The exporter is the last user-facing artifact (SHAPEZ2-2-<base64(gzip(JSON))>$)
// and had no tests. These decode the string with zlib.gunzipSync and pin:
//   • wrapper format
//   • entry count = machines with a gameId + belts (nothing silently dropped)
//   • machine T/R/L and belt T/R/L contracts
//   • the two silent-drop branches (missing BUILDING_DATA, unknown belt kind)
import { gunzipSync } from 'zlib';
import { exportBlueprintString } from '../../blueprintExport.js';
import { buildLayout } from '../../blueprintLayout.js';
import { BUILDING_DATA } from '../../buildingData.js';
import { LAYOUT_FIXTURES } from '../shared/fixtures.js';

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

const WRAPPER = /^SHAPEZ2-2-([A-Za-z0-9+/=]+)\$$/;
const DIR_TO_ROTATION = { E: 0, S: 1, W: 2, N: 3 };
const BELT_TYPE_MAP = {
    normal: 'BeltDefaultForwardInternalVariant',
    split: 'Splitter1To2LInternalVariant',
    merge: 'Merger2To1LInternalVariant',
    lift: 'BeltDefaultForwardInternalVariant',
};

function decode(str) {
    const m = WRAPPER.exec(str);
    if (!m) throw new Error(`wrapper mismatch: ${String(str).slice(0, 60)}`);
    const json = gunzipSync(Buffer.from(m[1], 'base64')).toString('utf8');
    return JSON.parse(json);
}

function exportableMachines(layout) {
    return layout.machines.filter(m => BUILDING_DATA[m.operation]?.gameId);
}

async function assertLayoutExport(label, layout) {
    const str = await exportBlueprintString(layout);
    checkTrue(`${label} wrapper`, WRAPPER.test(str), str.slice(0, 40));

    const bp = decode(str);
    const entries = bp.BP?.Entries;
    checkTrue(`${label} BP.$type is Building`, bp.BP?.$type === 'Building');
    checkTrue(`${label} Entries is an array`, Array.isArray(entries));

    const expectedMachines = exportableMachines(layout);
    check(`${label} entry count`, entries.length, expectedMachines.length + layout.belts.length);

    for (let i = 0; i < expectedMachines.length; i++) {
        const m = expectedMachines[i];
        const e = entries[i];
        check(`${label} machine[${i}] T`, e.T, BUILDING_DATA[m.operation].gameId);
        check(`${label} machine[${i}] X`, e.X, m.x);
        check(`${label} machine[${i}] Y`, e.Y, m.y);
        check(`${label} machine[${i}] R is 1 (south)`, e.R, 1);
        if (m.floor > 0) {
            check(`${label} machine[${i}] L`, e.L, m.floor);
        } else {
            checkTrue(`${label} machine[${i}] L absent on floor 0`, !('L' in e));
        }
    }

    const beltOffset = expectedMachines.length;
    for (let i = 0; i < layout.belts.length; i++) {
        const b = layout.belts[i];
        const e = entries[beltOffset + i];
        const expectedT = BELT_TYPE_MAP[b.kind] || BELT_TYPE_MAP.normal;
        check(`${label} belt[${i}] T`, e.T, expectedT);
        check(`${label} belt[${i}] X`, e.X, b.x);
        check(`${label} belt[${i}] Y`, e.Y, b.y);
        check(`${label} belt[${i}] R`, e.R, DIR_TO_ROTATION[b.direction] ?? 1);
        if (b.floor > 0) {
            check(`${label} belt[${i}] L`, e.L, b.floor);
        } else {
            checkTrue(`${label} belt[${i}] L absent on floor 0`, !('L' in e));
        }
    }
}

async function run() {
    for (const fixture of LAYOUT_FIXTURES) {
        const layout = buildLayout(fixture.solutionPath);
        checkTrue(
            `${fixture.name} has machines+belts to export`,
            layout.machines.length + layout.belts.length > 0,
            `machines=${layout.machines.length} belts=${layout.belts.length}`
        );
        await assertLayoutExport(fixture.name, layout);
    }

    // Floor > 0: L is emitted only then. Fixtures place machines on floor 0;
    // clone one machine/belt up a floor so the branch is asserted directly.
    {
        const base = buildLayout(LAYOUT_FIXTURES[0].solutionPath);
        const elevated = {
            ...base,
            machines: base.machines.map((m, i) => i === 0 ? { ...m, floor: 2 } : m),
            belts: base.belts.map((b, i) => i === 0 ? { ...b, floor: 2 } : b),
        };
        await assertLayoutExport('elevated floor', elevated);
    }

    // Negative: a machine whose operation is missing from BUILDING_DATA is
    // dropped. Documented so a silent drop cannot become an unnoticed empty
    // blueprint.
    {
        const layout = {
            machines: [
                { operation: 'NotAMachine', x: 3, y: 4, floor: 0 },
                { operation: 'Cutter', x: 1, y: 2, floor: 0 },
            ],
            belts: [
                { x: 0, y: 0, floor: 0, direction: 'E', kind: 'normal' },
            ],
        };
        const str = await exportBlueprintString(layout);
        const entries = decode(str).BP.Entries;
        check('unknown operation dropped: entry count', entries.length, 2);
        check('unknown operation dropped: remaining machine T', entries[0].T, BUILDING_DATA.Cutter.gameId);
        check('unknown operation dropped: remaining machine X', entries[0].X, 1);
        check('unknown operation dropped: belt kept', entries[1].T, BELT_TYPE_MAP.normal);
    }

    // Belt Split is null in BUILDING_DATA — same drop branch as a missing op.
    {
        const layout = {
            machines: [{ operation: 'Belt Split', x: 0, y: 0, floor: 0 }],
            belts: [{ x: 1, y: 0, floor: 0, direction: 'S', kind: 'normal' }],
        };
        const entries = decode(await exportBlueprintString(layout)).BP.Entries;
        check('Belt Split machine dropped: entry count', entries.length, 1);
        check('Belt Split machine dropped: only the belt remains', entries[0].T, BELT_TYPE_MAP.normal);
    }

    // Unknown belt kind silently falls back to a forward belt.
    {
        const layout = {
            machines: [],
            belts: [{ x: 2, y: 3, floor: 0, direction: 'W', kind: 'teleporter' }],
        };
        const entries = decode(await exportBlueprintString(layout)).BP.Entries;
        check('unknown belt kind → normal T', entries[0].T, BELT_TYPE_MAP.normal);
        check('unknown belt kind keeps direction R', entries[0].R, DIR_TO_ROTATION.W);
    }

    // lift is mapped to a plain forward belt (not a lift building).
    {
        const layout = {
            machines: [],
            belts: [{ x: 0, y: 1, floor: 1, direction: 'N', kind: 'lift' }],
        };
        const entries = decode(await exportBlueprintString(layout)).BP.Entries;
        check('lift belt T is forward', entries[0].T, BELT_TYPE_MAP.lift);
        check('lift belt T equals normal', entries[0].T, BELT_TYPE_MAP.normal);
        check('lift belt R', entries[0].R, DIR_TO_ROTATION.N);
        check('lift belt L on floor 1', entries[0].L, 1);
    }

    // Unknown direction falls back to R=1 (south), matching DIR_TO_ROTATION ?? 1.
    {
        const layout = {
            machines: [],
            belts: [{ x: 0, y: 0, floor: 0, direction: 'X', kind: 'normal' }],
        };
        const entries = decode(await exportBlueprintString(layout)).BP.Entries;
        check('unknown direction R defaults to 1', entries[0].R, 1);
    }

    console.log(`\n${passed}/${total} passed`);
    if (failed) process.exit(1);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
