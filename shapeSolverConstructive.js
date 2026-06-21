// Constructive decompose-and-search planner. Tries the bounded core search first
// at every node (so clever shortcuts the search finds are preserved), and only
// when that caps does it split the target — by-quadrant / by-half / by-layer —
// recurse on the pieces, and pick the cheapest assembled plan. Assembly is always
// a left-fold of `stack`; all cutting/rotating cleverness lives inside the
// recursively-solved pieces. Calls core shapeSolver as a subroutine; core never
// imports this module (no cycle). See docs/plans/2026-06-11-recursive-decompose-search-design.md

import { shapeSolver } from './shapeSolverCore.js';
import { splitByLayer, splitByQuadrant, splitByHalf, cost, opCountOf } from './shapeSolverDecompose.js';
import { stack, ShapeOperationConfig, getAllRotations } from './shapeOperations.js';
import { getCachedShape } from './shapeSolverCache.js';

export async function solveConstructive(
    targetShapeCode,
    startingShapeCodes,
    enabledOperations,
    maxLayers,
    preventWaste,
    orientationSensitive,
    monolayerPainting,
    heuristicDivisor = 0.1,
    shouldCancel = () => false,
    onProgress = () => {},
    nodeBudget = 4000
) {
    const config = new ShapeOperationConfig(maxLayers);
    const memo = new Map();   // code -> Plan | null (memoized sub-targets; identical pieces reuse the SAME Plan object)
    let statesTotal = 0;      // aggregate states across every base-case search (incl. capped attempts)

    // One bounded A* search for a single sub-target. Pieces are searched
    // orientation-sensitive (exact=true) so each comes back in its exact target
    // position and assembly stacks gravity-merge with no rotation; the top-level
    // target uses the caller's orientationSensitive. preventWaste is honoured only
    // at the top — sub-pieces ignore it (we want the piece, leftover waste is fine).
    async function coreSearch(code, exact, pw) {
        const res = await shapeSolver(
            code, startingShapeCodes, enabledOperations, maxLayers,
            Infinity,                        // maxStatesPerLevel — uncapped per-level
            pw, exact, monolayerPainting, heuristicDivisor,
            'A*', shouldCancel, onProgress,
            nodeBudget                       // maxStates — the per-node budget (fail-fast → decompose)
        );
        if (res) statesTotal += res.statesExplored || 0;
        return res;
    }

    const rotationsOf = (code) => new Set(getAllRotations(getCachedShape(code), config));

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

    // Solve one node: search first, decompose on cap. Returns a Plan, or null for
    // unsolvable/cancelled. Memoized by code (recursive pieces only).
    async function solvePlan(code, isTop) {
        if (!isTop && memo.has(code)) return memo.get(code);
        if (shouldCancel()) return null;

        const exact = isTop ? orientationSensitive : true;
        const pw = isTop ? preventWaste : false;
        onProgress(`Constructive | solving ${code} via direct-search | budget ${nodeBudget}`);
        const res = await coreSearch(code, exact, pw);
        if (res === null) return null; // cancelled

        let result;
        if (res.solutionPath) {
            const acceptable = exact ? new Set([code]) : rotationsOf(code);
            result = {
                target: code, method: 'direct-search', steps: res.solutionPath,
                outputId: findOutputId(res.solutionPath, acceptable),
                statesExplored: res.statesExplored, children: []
            };
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
                const candidate = { target: code, method, steps: [], outputId: null, statesExplored: 0, children };
                if (best === null || cost(candidate) < cost(best)) best = candidate;
            }
            result = best;
        }

        if (!isTop && !shouldCancel()) memo.set(code, result);
        return result;
    }

    // Flatten the chosen Plan tree into ONE step list with a single global id
    // space. Each direct-search sub-plan's local ids (starting + minted) are
    // offset into a disjoint range; a reused (object-shared) sub-plan is spliced
    // exactly ONCE, later consumers referencing its already-offset output id.
    function flatten(root) {
        const path = [];
        const emitted = new Map(); // Plan -> global output id
        let nextGlobalId = 0;

        function emit(plan) {
            if (emitted.has(plan)) return emitted.get(plan);
            let outId;
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
                outId = plan.outputId + base;
            } else {
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
                outId = accId;
            }
            emitted.set(plan, outId);
            return outId;
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
            opCount: opCountOf(plan),
            children: plan.children.map(buildTrace)
        };
    }

    const rootPlan = await solvePlan(targetShapeCode, true);

    if (!rootPlan) {
        return {
            solutionPath: null, depth: null, statesExplored: statesTotal,
            aborted: shouldCancel() ? null : 'no-decomposition', strategyTrace: null
        };
    }

    const solutionPath = flatten(rootPlan);
    return {
        solutionPath, depth: solutionPath.length, statesExplored: statesTotal,
        aborted: null, strategyTrace: buildTrace(rootPlan)
    };
}
