// Constructive decompose-and-search planner. Tries the bounded core search first
// at every node (so clever shortcuts the search finds are preserved), and only
// when that caps does it split the target — by-quadrant / by-half / by-layer —
// recurse on the pieces, and pick the cheapest assembled plan. Assembly is always
// a left-fold of `stack`; all cutting/rotating cleverness lives inside the
// recursively-solved pieces. Calls core shapeSolver as a subroutine; core never
// imports this module (no cycle). See docs/plans/2026-06-11-recursive-decompose-search-design.md

import { shapeSolver } from './shapeSolverCore.js';
import { splitByLayer, splitByQuadrant, splitByHalf, cost, opCountOf, isBareStart } from './shapeSolverDecompose.js';
import { ShapeOperationConfig } from './shapeClass.js';
import { stack } from './shapeOperations.js';
import { getAllRotations } from './shapeRotation.js';
import { getCachedShape } from './shapeSolverCache.js';
import {
    simulateFinalInventoryMap,
    acceptableCodes,
    pathReachesTarget,
} from './pathInventory.js';

// Options mirror shapeSolver's (minus the search-method-specific caps): a single
// named object so call sites don't re-spell the shared flag/numeric sequence. All
// knobs default to the app's typical solve; nodeBudget is the per-node core-search
// budget (fail-fast → decompose).
export async function solveConstructive(
    targetShapeCode,
    startingShapeCodes,
    enabledOperations,
    {
        maxLayers = 4,
        preventWaste = false,
        orientationSensitive = false,
        monolayerPainting = false,
        heuristicDivisor = 0.1,
        shouldCancel = () => false,
        onProgress = () => {},
        nodeBudget = 4000,
    } = {}
) {
    const config = new ShapeOperationConfig(maxLayers);
    const memo = new Map();   // code -> Plan | null (memoized sub-targets; identical pieces reuse the SAME Plan object)
    let statesTotal = 0;      // aggregate states across every base-case search (incl. capped attempts)
    // Reuse is only free when we may fan the shared product out with a Belt
    // Split. If the user disabled that operation we must not emit it, so reuse
    // degrades to re-building the sub-plan per consumer — and the cost metric
    // has to stop crediting it, or the planner picks reuse-heavy plans that are
    // no longer cheap. `null` reuseCost = charge the sub-plan again in full.
    const beltSplitEnabled = enabledOperations.includes('Belt Split');
    // Every decomposition assembles pieces with a left-fold of Stacker. Without
    // Stacker enabled we cannot emit that op, so splits are skipped entirely and
    // only the bounded direct search may solve the node.
    const stackerEnabled = enabledOperations.includes('Stacker');
    const trashEnabled = enabledOperations.includes('Trash');
    const costOpts = { reuseCost: beltSplitEnabled ? 1 : null };

    // One bounded A* search for a single sub-target. Pieces are searched
    // orientation-sensitive so each comes back in its exact target position and
    // assembly stacks gravity-merge with no rotation; the top-level target uses
    // the caller's orientationSensitive. preventWaste is honoured only at the top
    // — sub-pieces ignore it (we want the piece, leftover waste is fine).
    async function coreSearch(code, searchOrientationSensitive, searchPreventWaste) {
        const res = await shapeSolver(code, startingShapeCodes, enabledOperations, {
            maxLayers,
            maxStatesPerLevel: Infinity,     // uncapped per-level
            preventWaste: searchPreventWaste,
            orientationSensitive: searchOrientationSensitive,
            monolayerPainting,
            heuristicDivisor,
            searchMethod: 'A*',
            shouldCancel,
            onProgress,
            maxStates: nodeBudget,           // per-node budget (fail-fast → decompose)
        });
        if (res) statesTotal += res.statesExplored || 0;
        return res;
    }

    const rotationsOf = (code) => new Set(getAllRotations(getCachedShape(code), config));

    // Left-fold stack of piece codes (same op flatten emits). Gravity-merge can
    // collapse gappy multi-layer pairs into a wrong single-layer product
    // (e.g. CuCu---- + ----SuSu → CuCuSuSu), so candidates whose product is not
    // the parent target are rejected before we commit to them.
    function stackProduct(pieceCodes) {
        if (!pieceCodes.length) return null;
        let acc = pieceCodes[0];
        for (let i = 1; i < pieceCodes.length; i++) {
            acc = stack(getCachedShape(acc), getCachedShape(pieceCodes[i]), config)[0].toShapeCode();
        }
        return acc;
    }

    // Local id of the shape this plan produces: the last step that outputs an
    // acceptable code, or — for a 0-step solve — the matching starting shape's id
    // (core mints starting ids 0..n-1 in order, so the index IS the local id).
    function findOutputId(steps, acceptable) {
        for (let i = steps.length - 1; i >= 0; i--) {
            for (const o of steps[i].outputs) if (acceptable.has(o.shape)) return o.id;
        }
        for (let i = 0; i < startingShapeCodes.length; i++) {
            if (acceptable.has(startingShapeCodes[i])) return i;
        }
        return null; // unreachable for a solved plan
    }

    // The shape code a direct-search plan's outputId carries. Usually plan.target
    // verbatim (sub-pieces are searched orientation-sensitive), but the TOP plan
    // may legitimately land on a rotation of it, so read the code back rather
    // than assuming — a Belt Split must copy the shape that is actually on hand.
    function localOutputCode(plan) {
        for (let i = plan.steps.length - 1; i >= 0; i--) {
            for (const o of plan.steps[i].outputs) if (o.id === plan.outputId) return o.shape;
        }
        return startingShapeCodes[plan.outputId] ?? plan.target;
    }

    // Solve one node: search first, decompose on cap. Returns a Plan, or null for
    // unsolvable/cancelled. Memoized by code (recursive pieces only).
    async function solvePlan(code, isTop) {
        if (!isTop && memo.has(code)) return memo.get(code);
        if (shouldCancel()) return null;

        const nodeOrientationSensitive = isTop ? orientationSensitive : true;
        const nodePreventWaste = isTop ? preventWaste : false;
        onProgress(`Constructive | solving ${code} via direct-search | budget ${nodeBudget}`);
        const res = await coreSearch(code, nodeOrientationSensitive, nodePreventWaste);
        if (res === null) return null; // cancelled

        let result;
        if (res.solutionPath) {
            const acceptable = nodeOrientationSensitive ? new Set([code]) : rotationsOf(code);
            result = {
                target: code, method: 'direct-search', steps: res.solutionPath,
                outputId: findOutputId(res.solutionPath, acceptable),
                statesExplored: res.statesExplored, children: []
            };
        } else if (!stackerEnabled) {
            // Direct search failed/capped and we cannot assemble pieces without
            // Stacker — treat as unsolved at this node (no illegal Stacker emit).
            result = null;
        } else {
            // Search capped — try splits in order; keep the cheapest fully-solved one.
            const splits = [
                ['by-quadrant', splitByQuadrant(code)],
                ['by-half', splitByHalf(code)],
                ['by-layer', splitByLayer(code)]
            ];
            let best = null;
            for (const [method, pieces] of splits) {
                if (!pieces) continue;
                onProgress(`Constructive | decomposing ${code} via ${method} → ${pieces.join(' + ')}`);
                const children = [];
                let ok = true;
                for (const piece of pieces) {
                    if (shouldCancel()) return null;
                    const cp = await solvePlan(piece, false);
                    if (!cp) { ok = false; break; }
                    children.push(cp);
                }
                if (!ok) continue;
                // Pieces are orientation-sensitive for the parent code, so the
                // assembly product must match exactly — rotation-tolerant only
                // when the TOP node allows rotations (sub-nodes never do).
                const product = stackProduct(pieces);
                const productOk = nodeOrientationSensitive
                    ? product === code
                    : rotationsOf(code).has(product);
                if (!productOk) continue;
                const candidate = { target: code, method, steps: [], outputId: null, statesExplored: 0, children };
                if (best === null || cost(candidate, costOpts) < cost(best, costOpts)) best = candidate;
            }
            result = best;
        }

        if (!isTop && !shouldCancel()) memo.set(code, result);
        return result;
    }

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

    // Flatten the chosen Plan tree into ONE step list with a single global id
    // space. Each direct-search sub-plan's local ids (starting + minted) are
    // offset into a disjoint range.
    //
    // A reused (object-shared) sub-plan is built exactly ONCE and then fanned
    // out with an explicit Belt Split chain — N consumers need N-1 splits, each
    // consuming one copy and minting two. Handing every consumer the same global
    // id instead would be unbuildable: the solver deletes an id the moment it is
    // consumed, and blueprintPositions maps an id to a single output port, so two
    // consumers would draw belts from one port and double-spend the intermediate.
    // With Belt Split disabled there is no legal fan-out, so reuse falls back to
    // re-building the sub-plan per consumer in its own fresh id range.
    function flatten(root) {
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
                return { id: plan.outputId + base, code: localOutputCode(plan) };
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
    function buildTrace(plan) {
        return {
            target: plan.target,
            method: plan.method,
            statesExplored: plan.statesExplored,
            opCount: opCountOf(plan, costOpts),
            children: plan.children.map(buildTrace)
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
    function scrubPreventWaste(path) {
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

    const inventoryOpts = {
        starts: startingShapeCodes,
        config,
        orientationSensitive,
    };

    const rootPlan = await solvePlan(targetShapeCode, true);

    if (!rootPlan) {
        return {
            solutionPath: null, depth: null, statesExplored: statesTotal,
            aborted: shouldCancel() ? null : 'no-decomposition', strategyTrace: null
        };
    }

    let solutionPath = flatten(rootPlan);
    // Defense in depth: final hand must hold the target (shared pathReachesTarget
    // — same rule as the CI gate). Catches assembly/id bugs that slipped past
    // stackProduct rejection (Plan tree only). Distinct abort from missing splits.
    if (!pathReachesTarget(solutionPath, targetShapeCode, inventoryOpts)) {
        return {
            solutionPath: null, depth: null, statesExplored: statesTotal,
            aborted: shouldCancel() ? null : 'path-invalid',
            strategyTrace: buildTrace(rootPlan)
        };
    }
    if (preventWaste) {
        solutionPath = scrubPreventWaste(solutionPath);
        if (!solutionPath) {
            // Plan tree exists; failure is inventory cleanliness, not a missing
            // split — distinct from 'no-decomposition' so UI/callers can tell.
            return {
                solutionPath: null, depth: null, statesExplored: statesTotal,
                aborted: shouldCancel() ? null : 'preventWaste',
                strategyTrace: buildTrace(rootPlan)
            };
        }
    }
    return {
        solutionPath, depth: solutionPath.length, statesExplored: statesTotal,
        aborted: null, strategyTrace: buildTrace(rootPlan)
    };
}
