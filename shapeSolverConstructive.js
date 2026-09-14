// Constructive decompose-and-search planner. Tries the bounded core search first
// at every node (so clever shortcuts the search finds are preserved), and only
// when that caps does it split the target — by-quadrant / by-half / by-layer —
// recurse on the pieces, and pick the cheapest assembled plan. Assembly is always
// a left-fold of `stack`; all cutting/rotating cleverness lives inside the
// recursively-solved pieces. Calls core shapeSolver as a subroutine; core never
// imports this module (no cycle). Flattening the chosen Plan tree into a path,
// the final-inventory gate and the abort codes live in shapeSolverFlatten.js.
// See docs/plans/2026-06-11-recursive-decompose-search-design.md

import { shapeSolver } from './shapeSolverCore.js';
import { splitByLayer, splitByQuadrant, splitByHalf, cost, reuseCostOpts } from './shapeSolverDecompose.js';
import { constructiveResult } from './shapeSolverFlatten.js';
import { ShapeOperationConfig } from './shapeClass.js';
import { stack } from './shapeOperations.js';
import { getCachedShape } from './shapeSolverCache.js';
import { acceptableCodes } from './pathInventory.js';

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
    // Reuse credit depends on whether Belt Split may fan a shared product out
    // (see reuseCostOpts) — the same rule flatten follows when it emits the path.
    const costOpts = reuseCostOpts(enabledOperations);
    // Every decomposition assembles pieces with a left-fold of Stacker. Without
    // Stacker enabled we cannot emit that op, so splits are skipped entirely and
    // only the bounded direct search may solve the node.
    const stackerEnabled = enabledOperations.includes('Stacker');

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

        const acceptable = acceptableCodes(code, {
            orientationSensitive: nodeOrientationSensitive,
            config,
            shape: getCachedShape(code),
        });

        let result;
        if (res.solutionPath) {
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
                const productOk = acceptable.has(product);
                if (!productOk) continue;
                const candidate = { target: code, method, steps: [], outputId: null, statesExplored: 0, children };
                if (best === null || cost(candidate, costOpts) < cost(best, costOpts)) best = candidate;
            }
            result = best;
        }

        if (!isTop && !shouldCancel()) memo.set(code, result);
        return result;
    }

    const rootPlan = await solvePlan(targetShapeCode, true);
    return constructiveResult(rootPlan, {
        targetShapeCode,
        startingShapeCodes,
        enabledOperations,
        config,
        orientationSensitive,
        preventWaste,
        statesExplored: statesTotal,
        shouldCancel,
    });
}
