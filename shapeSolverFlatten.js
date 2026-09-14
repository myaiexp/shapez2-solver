// Turns the Constructive planner's chosen Plan tree into its solve result:
// flatten the tree into one globally-id'd step list, gate the final inventory,
// scrub preventWaste leftovers, and map every failure to its abort code. Kept
// apart from the planner so the abort mapping can be driven with hand-built Plan
// trees — including mis-assembled ones the planner's own stackProduct check
// rejects before they would ever reach flatten.

import { stack } from './shapeOperations.js';
import { getCachedShape } from './shapeSolverCache.js';
import { isBareStart, opCountOf, reuseCostOpts } from './shapeSolverDecompose.js';
import {
    simulateFinalInventoryMap,
    acceptableCodes,
    pathReachesTarget,
} from './pathInventory.js';

// How many consumers each Plan object has in the tree: one per reference as
// a child, plus one for the root (whose "consumer" is the caller). Shared
// sub-plans are walked once, so a reused plan's own children stay at the
// count they are actually built with.
function countConsumers(root) {
    const counts = new Map([[root, 1]]);
    const walked = new Set();
    (function walk(plan) {
        if (walked.has(plan)) return;
        walked.add(plan);
        for (const child of plan.children) {
            counts.set(child, (counts.get(child) ?? 0) + 1);
            walk(child);
        }
    })(root);
    return counts;
}

// The shape code a direct-search plan's outputId carries. Usually plan.target
// verbatim (sub-pieces are searched orientation-sensitive), but the TOP plan
// may legitimately land on a rotation of it, so read the code back rather
// than assuming — a Belt Split must copy the shape that is actually on hand.
function localOutputCode(plan, startingShapeCodes) {
    for (let i = plan.steps.length - 1; i >= 0; i--) {
        for (const o of plan.steps[i].outputs) if (o.id === plan.outputId) return o.shape;
    }
    return startingShapeCodes[plan.outputId] ?? plan.target;
}

// Flatten a Plan tree into ONE step list with a single global id space. Each
// direct-search sub-plan's local ids (starting + minted) are offset into a
// disjoint range.
//
// A reused (object-shared) sub-plan is built exactly ONCE and then fanned
// out with an explicit Belt Split chain — N consumers need N-1 splits, each
// consuming one copy and minting two. Handing every consumer the same global
// id instead would be unbuildable: the solver deletes an id the moment it is
// consumed, and blueprintPositions maps an id to a single output port, so two
// consumers would draw belts from one port and double-spend the intermediate.
// With Belt Split disabled there is no legal fan-out, so reuse falls back to
// re-building the sub-plan per consumer in its own fresh id range.
export function flattenPlan(root, { startingShapeCodes, beltSplitEnabled, config }) {
    const path = [];
    const fanout = countConsumers(root);
    const unclaimed = new Map();  // Plan -> global ids not yet handed to a consumer
    let nextGlobalId = 0;

    // Splice one plan's steps into `path`; returns the id + code it produces.
    function build(plan) {
        if (plan.method === 'direct-search') {
            const base = nextGlobalId;
            let maxLocal = startingShapeCodes.length - 1; // always reserve the starting id range
            for (const step of plan.steps) {
                for (const x of step.inputs) if (x.id > maxLocal) maxLocal = x.id;
                for (const x of step.outputs) if (x.id > maxLocal) maxLocal = x.id;
            }
            for (const step of plan.steps) {
                path.push({
                    operation: step.operation,
                    inputs: step.inputs.map((x) => ({ id: x.id + base, shape: x.shape })),
                    outputs: step.outputs.map((x) => ({ id: x.id + base, shape: x.shape })),
                    params: step.params
                });
            }
            nextGlobalId = base + maxLocal + 1;
            return { id: plan.outputId + base, code: localOutputCode(plan, startingShapeCodes) };
        }
        const childIds = plan.children.map(emit);
        let accId = childIds[0];
        let accCode = plan.children[0].target;
        for (let i = 1; i < plan.children.length; i++) {
            const pieceId = childIds[i];
            const pieceCode = plan.children[i].target;
            const newId = nextGlobalId++;
            const stackedCode = stack(getCachedShape(accCode), getCachedShape(pieceCode), config)[0].toShapeCode();
            path.push({
                operation: 'Stacker',
                inputs: [{ id: accId, shape: accCode }, { id: pieceId, shape: pieceCode }],
                outputs: [{ id: newId, shape: stackedCode }],
                params: {}
            });
            accId = newId;
            accCode = stackedCode;
        }
        return { id: accId, code: accCode };
    }

    // The id one consumer may take. First call builds the plan (and, when it
    // has several consumers, the Belt Split chain that copies its product);
    // later calls take the next copy, or re-build when splitting is disabled.
    function emit(plan) {
        // A zero-step plan IS a starting shape. Every sub-plan already gets
        // its own copy of the starting set (that is what the id offsetting
        // buys), so a second consumer just draws a second feed: free, and it
        // keeps full throughput where a split belt would halve it.
        if (!beltSplitEnabled || isBareStart(plan)) return build(plan).id;

        const queued = unclaimed.get(plan);
        if (queued) {
            // Impossible unless countConsumers and this traversal disagree —
            // loud beats silently re-handing an id that is already spent.
            if (!queued.length) throw new Error(`Constructive: plan for ${plan.target} consumed more often than counted`);
            return queued.shift();
        }

        const { id, code } = build(plan);
        const ids = [];
        let carry = id;
        for (let k = 1; k < (fanout.get(plan) ?? 1); k++) {
            const copyId = nextGlobalId++;
            const restId = nextGlobalId++;
            path.push({
                operation: 'Belt Split',
                inputs: [{ id: carry, shape: code }],
                outputs: [{ id: copyId, shape: code }, { id: restId, shape: code }],
                params: {}
            });
            ids.push(copyId);
            carry = restId;
        }
        ids.push(carry);
        unclaimed.set(plan, ids);
        return ids.shift();
    }

    emit(root);
    return path;
}

// Strategy trace mirroring the Plan tree (observability for the frontend).
function buildTrace(plan, costOpts) {
    return {
        target: plan.target,
        method: plan.method,
        statesExplored: plan.statesExplored,
        opCount: opCountOf(plan, costOpts),
        children: plan.children.map((child) => buildTrace(child, costOpts))
    };
}

// Append Trash steps for every non-acceptable leftover so preventWaste's
// "final inventory is only target rotations" contract holds. Sub-piece
// searches intentionally ignore preventWaste (waste is fine while building
// a piece); only the top-level path must be clean. Returns null when waste
// remains and Trash is disabled — the plan is then not a valid preventWaste
// solution. Acceptable set + start-seeded inventory walk come from
// pathInventory so harness pathInventoryAcceptable cannot drift from this
// scrub. Unused non-target starts are trashed too (core's preventWaste
// contract), not silently dropped as "invisible" leftovers.
function scrubPreventWaste(path, { targetShapeCode, startingShapeCodes, orientationSensitive, config, trashEnabled }) {
    const acceptable = acceptableCodes(targetShapeCode, { orientationSensitive, config });
    const inventory = simulateFinalInventoryMap(path, { starts: startingShapeCodes });

    const cleaned = path.slice();
    for (const [id, code] of inventory) {
        if (acceptable.has(code)) continue;
        if (!trashEnabled) return null;
        cleaned.push({
            operation: 'Trash',
            inputs: [{ id, shape: code }],
            outputs: [],
            params: {}
        });
    }
    return cleaned;
}

// The solveConstructive result for a chosen root Plan (null = no plan found).
// Owns all three abort codes; a cancelled solve reports none of them, whatever
// state it stopped in, so the UI shows "cancelled" rather than a failure.
export function constructiveResult(rootPlan, {
    targetShapeCode,
    startingShapeCodes,
    enabledOperations,
    config,
    orientationSensitive = false,
    preventWaste = false,
    statesExplored = 0,
    shouldCancel = () => false,
}) {
    const costOpts = reuseCostOpts(enabledOperations);
    const abort = (reason, strategyTrace) => ({
        solutionPath: null, depth: null, statesExplored,
        aborted: shouldCancel() ? null : reason, strategyTrace
    });

    if (!rootPlan) return abort('no-decomposition', null);

    let solutionPath = flattenPlan(rootPlan, {
        startingShapeCodes,
        beltSplitEnabled: enabledOperations.includes('Belt Split'),
        config,
    });
    // Defense in depth: final hand must hold the target (shared pathReachesTarget
    // — same rule as the CI gate). Catches assembly/id bugs that slipped past
    // stackProduct rejection (Plan tree only). Distinct abort from missing splits,
    // and checked before the preventWaste scrub so Trash steps cannot mask it.
    if (!pathReachesTarget(solutionPath, targetShapeCode, {
        starts: startingShapeCodes, config, orientationSensitive,
    })) {
        return abort('path-invalid', buildTrace(rootPlan, costOpts));
    }
    if (preventWaste) {
        solutionPath = scrubPreventWaste(solutionPath, {
            targetShapeCode, startingShapeCodes, orientationSensitive, config,
            trashEnabled: enabledOperations.includes('Trash'),
        });
        // Plan tree exists; failure is inventory cleanliness, not a missing
        // split — distinct from 'no-decomposition' so UI/callers can tell.
        if (!solutionPath) return abort('preventWaste', buildTrace(rootPlan, costOpts));
    }
    return {
        solutionPath, depth: solutionPath.length, statesExplored,
        aborted: null, strategyTrace: buildTrace(rootPlan, costOpts)
    };
}
