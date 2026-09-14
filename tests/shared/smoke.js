import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { cut, stack } from '../../shapeOperations.js';
import { rotate90CW } from '../../shapeRotation.js';
import { getSimilarity } from './similarity.js';
import { buildLayout } from '../../blueprintLayout.js';
import { shapeSolver } from '../../shapeSolverCore.js';
import { shapeExplorer } from '../../shapeExplorerCore.js';
import { invalidPathSteps, invalidPathIds, pathReachesTarget, pathInventoryAcceptable, invalidExplorerEdges } from './pathValidation.js';
import { PURE_OP_CHECKS, LAYOUT_FIXTURES, SOLVER_FIXTURES, EXPLORER_FIXTURES } from './fixtures.js';
import { applySnapshot } from './smokeSnapshot.js';
import { overlappingBeltTiles, beltsOverMachineFootprint } from './layoutCollisions.js';
import { isValidSolutionPath } from '../../persistence.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_PATH = join(__dirname, 'snapshots.json');
const UPDATE = process.env.SMOKE_UPDATE === '1';

const OPS = { cut, stack, rotate90CW, getSimilarity };

function loadSnapshots() {
    if (!existsSync(SNAPSHOTS_PATH)) {
        if (!UPDATE) {
            console.log('✗ tests/shared/snapshots.json is missing — run SMOKE_UPDATE=1 node tests/shared/smoke.js to record baselines');
            process.exit(1);
        }
        return {};
    }
    return JSON.parse(readFileSync(SNAPSHOTS_PATH, 'utf8'));
}

function saveSnapshots(snapshots) {
    writeFileSync(SNAPSHOTS_PATH, JSON.stringify(snapshots, null, 2) + '\n');
}

function resultToSnapshot(result) {
    if (Array.isArray(result)) {
        return result.map(s => s.toShapeCode());
    }
    return result;
}

let passed = 0;
let total = 0;
let failed = false;
const snapshots = loadSnapshots();

function compareSnapshot(key, actual) {
    total++;
    const result = applySnapshot(key, actual, snapshots, { update: UPDATE });
    if (result.status === 'written') {
        saveSnapshots(snapshots);
        console.log(`[baseline written] ${key}`);
        passed++;
        return;
    }
    if (result.status === 'updated') {
        saveSnapshots(snapshots);
        console.log(`[baseline updated] ${key}`);
        passed++;
        return;
    }
    if (result.status === 'missing') {
        console.log(`✗ ${key} — no baseline recorded`);
        failed = true;
        return;
    }
    if (result.status === 'pass') {
        console.log(`\u2713 ${key}`);
        passed++;
        return;
    }
    console.log(`\u2717 ${key} \u2014 expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(actual)}`);
    failed = true;
}

for (const fixture of PURE_OP_CHECKS) {
    const key = `Op: ${fixture.name}`;
    const fn = OPS[fixture.op];
    const args = fixture.shapeArgs.map(code => Shape.fromShapeCode(code));
    const raw = fn(...args);
    compareSnapshot(key, resultToSnapshot(raw));
}

for (const fixture of LAYOUT_FIXTURES) {
    const key = `Layout: ${fixture.name}`;
    // Correctness gate (independent of the snapshot): layout fixtures are
    // hand-written, so a swapped Cutter port order or fabricated stack product
    // would still produce stable machine/belt counts and hide port-order
    // regressions. Refuse to snapshot an unbuildable path.
    const layoutConfig = new ShapeOperationConfig(4);
    const badLayoutSteps = invalidPathSteps(fixture.solutionPath, layoutConfig);
    if (badLayoutSteps.length) {
        total++;
        console.log(`\u2717 ${key} \u2014 INVALID path: ${badLayoutSteps.join(' | ')}`);
        failed = true;
        continue;
    }
    const badLayoutIds = invalidPathIds(fixture.solutionPath);
    if (badLayoutIds.length) {
        total++;
        console.log(`\u2717 ${key} \u2014 UNBUILDABLE id flow: ${badLayoutIds.join(' | ')}`);
        failed = true;
        continue;
    }

    const layout = buildLayout(fixture.solutionPath);
    // Invariant gate (before the snapshot, so SMOKE_UPDATE=1 can't bless a
    // regression): belts must never be routed across a machine footprint.
    // overlappingBeltTiles stays snapshot-only — it is non-zero by design today.
    const beltsOnMachines = beltsOverMachineFootprint(layout.belts, layout.machines);
    if (beltsOnMachines !== 0) {
        total++;
        console.log(`✗ ${key} — ${beltsOnMachines} belt tile(s) over a machine footprint`);
        failed = true;
        continue;
    }
    compareSnapshot(key, {
        machineCount: layout.machines.length,
        beltCount: layout.belts.length,
        overlappingBeltTiles: overlappingBeltTiles(layout.belts),
        beltsOverMachineFootprint: beltsOverMachineFootprint(layout.belts, layout.machines),
        gridWidth: layout.gridWidth,
        gridHeight: layout.gridHeight,
        floorCount: layout.floorCount,
    });
}

for (const fixture of SOLVER_FIXTURES) {
    const key = `Solver: ${fixture.name}`;
    const result = await shapeSolver(fixture.target, fixture.starting, fixture.ops, {
        maxLayers: fixture.maxLayers,
        maxStatesPerLevel: fixture.maxStatesPerLevel,
        preventWaste: fixture.preventWaste,
        orientationSensitive: fixture.orientationSensitive,
        monolayerPainting: fixture.monolayerPainting,
        heuristicDivisor: fixture.heuristicDivisor,
        searchMethod: fixture.method,
        // Cap distinct states so a runaway fixture can't OOM helm's cgroup.
        // Existing fixtures all solve in well under this; it only bounds the worst case.
        maxStates: fixture.maxStates ?? 100000,
    });
    const path = result?.solutionPath ?? null;

    // Correctness gate (independent of the snapshot): every step must be a real op,
    // validated under the same layer cap the solver ran with.
    const config = new ShapeOperationConfig(fixture.maxLayers);
    const badSteps = invalidPathSteps(path, config);
    if (badSteps.length) {
        total++;
        console.log(`✗ ${key} — INVALID path: ${badSteps.join(' | ')}`);
        failed = true;
        continue;
    }

    // Id-integrity gate (independent of the snapshot): every step can replay
    // perfectly while the path feeds one machine's output to two consumers.
    // Passing `starting` also rejects inputs conjured from outside the start set.
    const badIds = invalidPathIds(path, { starts: fixture.starting });
    if (badIds.length) {
        total++;
        console.log(`✗ ${key} — UNBUILDABLE id flow: ${badIds.join(' | ')}`);
        failed = true;
        continue;
    }

    // Goal gate (independent of the snapshot): valid ops alone don't prove the
    // path built the target — the final inventory must actually contain it (any
    // rotation unless orientation-sensitive). Catches wrong-assembly and
    // target-trashed paths that every step-level check would still pass. `starts`
    // makes a zero-op already-solved path pass rather than read as "no solution".
    if (!pathReachesTarget(path, fixture.target, { starts: fixture.starting, config, orientationSensitive: fixture.orientationSensitive })) {
        total++;
        console.log(`✗ ${key} — path does not reach target ${fixture.target}`);
        failed = true;
        continue;
    }

    // preventWaste cleanliness: pathReachesTarget only requires the target to be
    // *among* leftovers. Under preventWaste every inventory code must be an
    // acceptable form of the target (same gate constructive.test.js uses).
    if (fixture.preventWaste && !pathInventoryAcceptable(path, fixture.target, {
        starts: fixture.starting,
        config,
        orientationSensitive: fixture.orientationSensitive,
    })) {
        total++;
        console.log(`✗ ${key} — preventWaste path leaves non-target waste`);
        failed = true;
        continue;
    }

    // Restore gate: persistence.js rejects a saved solution whose steps fail
    // isValidSolutionPath, so a solver path it refuses would vanish on reload.
    // Feeding it real solver output (incl. colored Painter/Crystal steps) is the
    // check its hand-built unit fixtures can't make.
    if (path && !isValidSolutionPath(path)) {
        total++;
        console.log(`✗ ${key} — persistence.isValidSolutionPath rejects the solver path`);
        failed = true;
        continue;
    }

    compareSnapshot(key, {
        numOps: path ? path.length : null,
        depth: result?.depth ?? null,
    });
}

for (const fixture of EXPLORER_FIXTURES) {
    const key = `Explorer: ${fixture.name}`;
    const graph = await shapeExplorer(
        fixture.starting,
        fixture.ops,
        fixture.depthLimit,
        fixture.maxLayers,
        () => false,
        () => {},
        fixture.target ?? null,
    );
    // Structural snapshots alone miss wrong expand/prune that preserves counts.
    // Re-validate every edge as a real op (same gate as solve.mjs --explore).
    const edgeConfig = new ShapeOperationConfig(fixture.maxLayers ?? 4);
    const badEdges = invalidExplorerEdges(graph, edgeConfig);
    if (badEdges.length) {
        total++;
        console.log(`\u2717 ${key} \u2014 ${badEdges.length} invalid edge(s):`);
        for (const msg of badEdges) console.log(`    ${msg}`);
        failed = true;
        continue;
    }
    // Content gate: count snapshots can't tell which color a colored op chose.
    const codes = new Set((graph?.shapes ?? []).map(s => s.code));
    const missingShapes = (fixture.expectShapes ?? []).filter(c => !codes.has(c));
    if (missingShapes.length) {
        total++;
        console.log(`✗ ${key} — expected shape(s) missing: ${missingShapes.join(', ')}`);
        failed = true;
        continue;
    }
    compareSnapshot(key, {
        shapeCount: graph?.shapes?.length ?? null,
        opCount: graph?.ops?.length ?? null,
        edgeCount: graph?.edges?.length ?? null,
    });
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
