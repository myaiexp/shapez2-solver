// Constructive flatten + abort mapping, driven with hand-built Plan trees.
// Run with: node tests/solver/shapeSolverFlatten.test.js
//
// The planner's stackProduct check rejects mis-assembled candidates before they
// reach flatten, so no end-to-end solve produces aborted: 'path-invalid'. That
// abort is the defense-in-depth gate for an assembly/id bug slipping past the
// planner; feeding a mis-assembled tree straight into constructiveResult is the
// only way to prove the gate fires, reports its own code (not no-decomposition),
// and never ships the path.
import { constructiveResult, flattenPlan } from '../../shapeSolverFlatten.js';
import { operations } from '../../shapeSolverOperations.js';
import { ShapeOperationConfig } from '../../shapeClass.js';
import {
    invalidPathSteps,
    invalidPathIds,
    pathReachesTarget,
    pathInventoryAcceptable,
} from '../shared/pathValidation.js';

const ALL_OPS = Object.keys(operations);
const NO_TRASH = ALL_OPS.filter((op) => op !== 'Trash');
const cfg = new ShapeOperationConfig(4);

let passed = 0, total = 0, failed = false;
function assert(name, cond, detail) {
    total++;
    if (cond) { console.log(`✓ ${name}`); passed++; }
    else { console.log(`✗ ${name} — assertion failed${detail ? `: ${detail}` : ''}`); failed = true; }
}

// A zero-step direct-search leaf: the piece IS starting shape `index`.
const leaf = (target, index) =>
    ({ target, method: 'direct-search', steps: [], outputId: index, statesExplored: 3, children: [] });
const split = (target, method, children) =>
    ({ target, method, steps: [], outputId: null, statesExplored: 0, children });
const result = (plan, target, starts, extra = {}) => constructiveResult(plan, {
    targetShapeCode: target, startingShapeCodes: starts, enabledOperations: ALL_OPS,
    config: cfg, statesExplored: 42, ...extra,
});

// --- well-formed by-quadrant plan: the control case ---------------------------
{
    const starts = ['Cu------', '--Ru----'];
    const plan = split('CuRu----', 'by-quadrant', [leaf('Cu------', 0), leaf('--Ru----', 1)]);
    const r = result(plan, 'CuRu----', starts);
    assert('well-formed plan solves', r.aborted === null && !!r.solutionPath, `aborted=${r.aborted}`);
    assert('well-formed plan is one Stacker producing the target',
        r.solutionPath?.length === 1 && r.solutionPath[0].operation === 'Stacker' &&
        r.solutionPath[0].outputs[0].shape === 'CuRu----');
    assert('well-formed plan depth = path length', r.depth === 1);
    assert('statesExplored is passed through', r.statesExplored === 42);
    assert('strategyTrace mirrors the plan tree',
        r.strategyTrace.method === 'by-quadrant' && r.strategyTrace.opCount === 1 &&
        r.strategyTrace.children.length === 2 &&
        r.strategyTrace.children.every((c) => c.method === 'direct-search' && c.statesExplored === 3));
    const badSteps = invalidPathSteps(r.solutionPath, cfg);
    assert('well-formed path steps are real ops', badSteps.length === 0, badSteps.join(' | '));
    const badIds = invalidPathIds(r.solutionPath, { starts });
    assert('well-formed path ids flow', badIds.length === 0, badIds.join(' | '));
}

// --- mis-assembled plan: pieces stack to Cu--Ru--, not CuRu---- ---------------
const MIS_STARTS = ['Cu------', '----Ru--'];
const misassembled = () =>
    split('CuRu----', 'by-quadrant', [leaf('Cu------', 0), leaf('----Ru--', 1)]);
{
    const path = flattenPlan(misassembled(), { startingShapeCodes: MIS_STARTS, beltSplitEnabled: true, config: cfg });
    assert('flatten emits the wrong product (the bug the gate must catch)',
        path.length === 1 && path[0].outputs[0].shape === 'Cu--Ru--', JSON.stringify(path));
    assert('that path genuinely lacks the target',
        !pathReachesTarget(path, 'CuRu----', { starts: MIS_STARTS, config: cfg }));

    const r = result(misassembled(), 'CuRu----', MIS_STARTS);
    assert('mis-assembled plan aborts path-invalid', r.aborted === 'path-invalid', `aborted=${r.aborted}`);
    assert('path-invalid ships no path', r.solutionPath === null && r.depth === null);
    assert('path-invalid keeps the strategyTrace',
        r.strategyTrace?.method === 'by-quadrant' && r.strategyTrace.children.length === 2);
    assert('path-invalid still reports statesExplored', r.statesExplored === 42);
}
{
    // The scrub runs after the gate: Trash steps must not paper over a path
    // that never held the target, with or without Trash available.
    const withTrash = result(misassembled(), 'CuRu----', MIS_STARTS, { preventWaste: true });
    assert('path-invalid wins over preventWaste scrub (Trash on)', withTrash.aborted === 'path-invalid');
    const noTrash = result(misassembled(), 'CuRu----', MIS_STARTS, { preventWaste: true, enabledOperations: NO_TRASH });
    assert('path-invalid wins over preventWaste abort (Trash off)', noTrash.aborted === 'path-invalid');
}
{
    const r = result(misassembled(), 'CuRu----', MIS_STARTS, { shouldCancel: () => true });
    assert('cancelled mis-assembled solve reports no abort reason', r.aborted === null && r.solutionPath === null);
}

// --- direct-search root that ends on the wrong orientation --------------------
// orientationSensitive must reach the gate: a rotated product is fine when
// rotations are allowed and path-invalid when they are not.
{
    const starts = ['CuRu----'];
    const rotated = () => ({
        target: 'CuRu----', method: 'direct-search', outputId: 1, statesExplored: 5, children: [],
        steps: [{ operation: 'Rotator CW', inputs: [{ id: 0, shape: 'CuRu----' }], outputs: [{ id: 1, shape: '--CuRu--' }], params: {} }],
    });
    const badSteps = invalidPathSteps(rotated().steps, cfg);
    assert('rotated fixture is a real Rotator CW step', badSteps.length === 0, badSteps.join(' | '));
    const loose = result(rotated(), 'CuRu----', starts, { orientationSensitive: false });
    assert('rotation accepted when not orientation-sensitive', loose.aborted === null && loose.solutionPath?.length === 1);
    const strict = result(rotated(), 'CuRu----', starts, { orientationSensitive: true });
    assert('rotation is path-invalid when orientation-sensitive', strict.aborted === 'path-invalid');
}

// --- no plan at all -----------------------------------------------------------
{
    const r = result(null, 'CuRu----', MIS_STARTS);
    assert('null root aborts no-decomposition', r.aborted === 'no-decomposition' && r.solutionPath === null);
    assert('no-decomposition has no strategyTrace', r.strategyTrace === null);
    const cancelled = result(null, 'CuRu----', MIS_STARTS, { shouldCancel: () => true });
    assert('cancelled null root reports no abort reason', cancelled.aborted === null);
}

// --- preventWaste on a well-formed plan with a leftover start -----------------
{
    const starts = ['Cu------', '--Ru----', 'SuSuSuSu'];
    const plan = () => split('CuRu----', 'by-quadrant', [leaf('Cu------', 0), leaf('--Ru----', 1)]);
    const noTrash = result(plan(), 'CuRu----', starts, { preventWaste: true, enabledOperations: NO_TRASH });
    assert('leftovers without Trash abort preventWaste', noTrash.aborted === 'preventWaste' && noTrash.solutionPath === null);
    assert('preventWaste abort keeps the strategyTrace', noTrash.strategyTrace?.method === 'by-quadrant');
    const withTrash = result(plan(), 'CuRu----', starts, { preventWaste: true });
    assert('leftovers with Trash are scrubbed', withTrash.aborted === null &&
        withTrash.solutionPath.some((s) => s.operation === 'Trash'));
    assert('scrubbed path is waste-free',
        pathInventoryAcceptable(withTrash.solutionPath, 'CuRu----', { starts, config: cfg }));
}

// --- reuse: one shared built sub-plan, two consumers --------------------------
{
    const starts = ['Cu------'];
    const sub = {
        target: '--Cu----', method: 'direct-search', outputId: 1, statesExplored: 2, children: [],
        steps: [{ operation: 'Rotator CW', inputs: [{ id: 0, shape: 'Cu------' }], outputs: [{ id: 1, shape: '--Cu----' }], params: {} }],
    };
    const target = '--Cu----:--Cu----';
    const plan = split(target, 'by-layer', [sub, sub]);
    for (const beltSplitEnabled of [true, false]) {
        const label = `shared sub-plan (Belt Split ${beltSplitEnabled ? 'on' : 'off'})`;
        const path = flattenPlan(plan, { startingShapeCodes: starts, beltSplitEnabled, config: cfg });
        const ops = path.map((s) => s.operation).join(',');
        assert(`${label} emits the expected ops`,
            ops === (beltSplitEnabled ? 'Rotator CW,Belt Split,Stacker' : 'Rotator CW,Rotator CW,Stacker'), ops);
        const badSteps = invalidPathSteps(path, cfg);
        assert(`${label} steps are real ops`, badSteps.length === 0, badSteps.join(' | '));
        const badIds = invalidPathIds(path, { starts });
        assert(`${label} ids flow (no double-spend)`, badIds.length === 0, badIds.join(' | '));
        assert(`${label} reaches the target`, pathReachesTarget(path, target, { starts, config: cfg }));
    }
}

console.log(`\n${passed}/${total} passed`);
if (failed) process.exit(1);
