import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Shape, ShapeOperationConfig } from '../../shapeClass.js';
import { cut, stack } from '../../shapeOperations.js';
import { rotate90CW } from '../../shapeRotation.js';
import { getSimilarity } from '../../shapeAnalysis.js';
import { buildLayout } from '../../blueprintLayout.js';
import { shapeSolver } from '../../shapeSolverCore.js';
import { shapeExplorer } from '../../shapeExplorerCore.js';
import { invalidPathSteps, pathReachesTarget } from './pathValidation.js';
import { PURE_OP_CHECKS, LAYOUT_FIXTURES, SOLVER_FIXTURES, EXPLORER_FIXTURES } from './fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS_PATH = join(__dirname, 'snapshots.json');

const OPS = { cut, stack, rotate90CW, getSimilarity };

function loadSnapshots() {
    if (!existsSync(SNAPSHOTS_PATH)) return {};
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

for (const fixture of PURE_OP_CHECKS) {
    const key = `Op: ${fixture.name}`;
    total++;
    const fn = OPS[fixture.op];
    const args = fixture.shapeArgs.map(code => Shape.fromShapeCode(code));
    const raw = fn(...args);
    const actual = resultToSnapshot(raw);
    if (!(key in snapshots)) {
        snapshots[key] = actual;
        saveSnapshots(snapshots);
        console.log(`[baseline written] ${key}`);
        passed++;
    } else {
        const expected = snapshots[key];
        const match = JSON.stringify(actual) === JSON.stringify(expected);
        if (match) {
            console.log(`\u2713 ${key}`);
            passed++;
        } else {
            console.log(`\u2717 ${key} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            failed = true;
        }
    }
}

for (const fixture of LAYOUT_FIXTURES) {
    const key = `Layout: ${fixture.name}`;
    total++;
    const layout = buildLayout(fixture.solutionPath);
    const actual = {
        machineCount: layout.machines.length,
        beltCount: layout.belts.length,
        gridWidth: layout.gridWidth,
        gridHeight: layout.gridHeight,
        floorCount: layout.floorCount,
    };
    if (!(key in snapshots)) {
        snapshots[key] = actual;
        saveSnapshots(snapshots);
        console.log(`[baseline written] ${key}`);
        passed++;
    } else {
        const expected = snapshots[key];
        const match = JSON.stringify(actual) === JSON.stringify(expected);
        if (match) {
            console.log(`\u2713 ${key}`);
            passed++;
        } else {
            console.log(`\u2717 ${key} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            failed = true;
        }
    }
}

for (const fixture of SOLVER_FIXTURES) {
    const key = `Solver: ${fixture.name}`;
    total++;
    const result = await shapeSolver(
        fixture.target,
        fixture.starting,
        fixture.ops,
        fixture.maxLayers,
        fixture.maxStatesPerLevel,
        fixture.preventWaste,
        fixture.orientationSensitive,
        fixture.monolayerPainting,
        fixture.heuristicDivisor,
        fixture.method,
        () => false,
        () => {},
        // Cap distinct states so a runaway fixture can't OOM helm's cgroup.
        // Existing fixtures all solve in well under this; it only bounds the worst case.
        fixture.maxStates ?? 100000
    );
    const path = result?.solutionPath ?? null;

    // Correctness gate (independent of the snapshot): every step must be a real op,
    // validated under the same layer cap the solver ran with.
    const config = new ShapeOperationConfig(fixture.maxLayers);
    const badSteps = invalidPathSteps(path, config);
    if (badSteps.length) {
        console.log(`✗ ${key} — INVALID path: ${badSteps.join(' | ')}`);
        failed = true;
        continue;
    }

    // Goal gate (independent of the snapshot): valid ops alone don't prove the
    // path built the target — the final inventory must actually contain it (any
    // rotation unless orientation-sensitive). Catches wrong-assembly and
    // target-trashed paths that every step-level check would still pass.
    if (!pathReachesTarget(path, fixture.target, { config, orientationSensitive: fixture.orientationSensitive })) {
        console.log(`✗ ${key} — path does not reach target ${fixture.target}`);
        failed = true;
        continue;
    }

    const actual = {
        numOps: path ? path.length : null,
        depth: result?.depth ?? null,
    };
    if (!(key in snapshots)) {
        snapshots[key] = actual;
        saveSnapshots(snapshots);
        console.log(`[baseline written] ${key}`);
        passed++;
    } else {
        const expected = snapshots[key];
        const match = JSON.stringify(actual) === JSON.stringify(expected);
        if (match) {
            console.log(`\u2713 ${key}`);
            passed++;
        } else {
            console.log(`\u2717 ${key} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            failed = true;
        }
    }
}

for (const fixture of EXPLORER_FIXTURES) {
    const key = `Explorer: ${fixture.name}`;
    total++;
    const graph = await shapeExplorer(
        fixture.starting,
        fixture.ops,
        fixture.depthLimit,
        fixture.maxLayers,
        () => false,
        () => {}
    );
    const actual = {
        shapeCount: graph?.shapes?.length ?? null,
        opCount: graph?.ops?.length ?? null,
        edgeCount: graph?.edges?.length ?? null,
    };
    if (!(key in snapshots)) {
        snapshots[key] = actual;
        saveSnapshots(snapshots);
        console.log(`[baseline written] ${key}`);
        passed++;
    } else {
        const expected = snapshots[key];
        const match = JSON.stringify(actual) === JSON.stringify(expected);
        if (match) {
            console.log(`\u2713 ${key}`);
            passed++;
        } else {
            console.log(`\u2717 ${key} \u2014 expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
            failed = true;
        }
    }
}

// Persistence: schema round-trips through JSON without loss.
{
    const key = 'Persistence: schema round-trip';
    total++;
    const state = {
        version: 1,
        inputs: {
            target: 'CuRuSuWu:CuCuCuCu',
            depthLimit: '10',
            startingShapes: ['CuCuCuCu', 'RuRuRuRu'],
            enabledOperations: ['cut', 'stack', 'paint'],
            searchMethod: 'A*',
            maxStatesPerLevel: '7500',
            heuristicDivisor: '0.1',
            preventWaste: true,
            orientationSensitive: false,
            monolayerPainting: false,
            filterUnusedShapes: true,
            throughputMultiplier: '2',
            maxLayers: '4',
            colorMode: 'rgb',
        },
        solution: {
            solutionPath: [{ op: 'cut', inputs: ['CuCuCuCu'], outputs: [{ shape: 'Cu------' }], params: {} }],
            depth: 1,
            statesExplored: 42,
            solveTimeSec: '0.05',
        },
        view: {
            activeSidebarTab: 'options',
            activeOutputView: 'blueprint',
            graphDirection: 'TB',
            edgeStyle: 'curved',
            blueprintFloor: 0,
        },
    };
    const roundTripped = JSON.parse(JSON.stringify(state));
    const match = JSON.stringify(roundTripped) === JSON.stringify(state);
    if (match) {
        console.log(`\u2713 ${key}`);
        passed++;
    } else {
        console.log(`\u2717 ${key} \u2014 round-trip mismatch`);
        failed = true;
    }
}

console.log(`[${passed}/${total} passed]`);
process.exit(failed ? 1 : 0);
