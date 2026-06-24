import { ShapeOperationConfig, NOTHING_CHAR } from './shapeClass.js';
import { getAllRotations } from './shapeOperations.js';
import { getCrystalColors } from './shapeAnalysis.js';
import { PriorityQueue } from './shapeSolverPriorityQueue.js';
import {
    shapeCache,
    operationResultCache,
    getCachedShape,
} from './shapeSolverCache.js';
import { buildBackwardReachability } from './shapeSolverBackward.js';
import { operations } from './shapeSolverOperations.js';
import { expandUnaryOp, expandBinaryOp } from './shapeSolverExpansion.js';

export { operations } from './shapeSolverOperations.js';

// Backward BFS depth for Bidirectional search: how many reverse operations to
// precompute outward from the target before the forward A* runs. 4 trades map
// coverage against build cost (the reverse frontier branches fast); it is fixed
// rather than user-tunable and intentionally independent of maxLayers.
const BIDIRECTIONAL_BACKWARD_DEPTH = 4;

// ---------------------------------------------------------------------------
// Main solver
// ---------------------------------------------------------------------------

export async function shapeSolver(
    targetShapeCode,
    startingShapeCodes,
    enabledOperations,
    maxLayers,
    maxStatesPerLevel = Infinity,
    preventWaste,
    orientationSensitive,
    monolayerPainting,
    heuristicDivisor = 0.1,
    searchMethod = 'A*',
    shouldCancel = () => false,
    onProgress = () => {},
    // Optional ceiling on distinct states discovered. Default Infinity (uncapped):
    // the browser app runs without a cap and relies on the Cancel button, since an
    // OOM there only crashes the user's own tab. Callers running inside a memory-
    // constrained host (e.g. the node harness in helm's cgroup) pass a finite value
    // to bound memory; on the cap the search aborts gracefully and returns
    // { ..., aborted: 'maxStates' } instead of running the process out of memory.
    maxStates = Infinity
) {
    // Clear caches between solves to prevent unbounded memory growth
    shapeCache.clear();
    operationResultCache.clear();

    const target = getCachedShape(targetShapeCode);
    const targetCrystalColors = getCrystalColors(target);
    const config = new ShapeOperationConfig(maxLayers);
    const startTime = performance.now();
    let lastUpdate = startTime;
    let depth = 0;
    let aborted = false;  // set true when the maxStates cap is hit

    // Precompute acceptable shape codes
    const acceptable = new Set();
    if (orientationSensitive) {
        acceptable.add(targetShapeCode);
    } else {
        const rotations = getAllRotations(target, config);
        for (const code of rotations) {
            acceptable.add(code);
        }
    }

    // Initialize shapes with unique IDs
    let nextId = 0;
    const shapes = new Map();
    const initialAvailableIds = new Set();
    for (const code of startingShapeCodes) {
        shapes.set(nextId, code);
        initialAvailableIds.add(nextId);
        nextId++;
    }

    // ---------------------------------------------------------------------------
    // Clean sub-shape coverage heuristic (idea #1677)
    // ---------------------------------------------------------------------------
    // Similarity-to-target was a poor guide for ASSEMBLY targets, in two ways:
    //   1. A single building-block quadrant (e.g. Cu------) scored the SAME as the
    //      uniform start it came from (CuCuCuCu), so cutting toward the right piece
    //      showed zero progress.
    //   2. Taking the max similarity over available shapes gave NO credit for holding
    //      several complementary pieces at once, so assembling the 2nd/3rd/4th
    //      quadrant in parallel sat on a flat plateau — across which A* degenerates to
    //      brute BFS and floods the state cap before it can stack them together.
    //
    // Instead we score each target SLOT independently by how close any held shape is to
    // cleanly providing it, then sum — so progress on the 2nd/3rd/4th quadrant counts
    // even while it is still being cut, leaving no plateau for the frontier to flood.
    // Per shape, over rotations, we compute:
    //   • slotCost: for each target (layer,quadrant) the shape can fill with the right
    //     part, the rough ops to ISOLATE that part = conflicts (its other filled slots
    //     that do not match the target), capped at 3. 0 when the shape is already a
    //     clean sub-shape. So CuCuCuCu (3 conflicts) → 3, CuCu---- (1) → 1, Cu------ → 0.
    //   • cleanSlots: target slots covered when the shape is a fully clean sub-shape
    //     (no conflicts) — a piece that can be stacked straight in. [] otherwise.
    // Colour is ignored: a wrong colour is one cheap Painter op, whereas STRUCTURE is
    // what the search cannot assemble.
    function _matchAndCoverage(shape) {
        const rotShapes = orientationSensitive
            ? [shape]
            : Array.from(getAllRotations(shape, config)).map(getCachedShape);
        let bestClean = [];
        const slotCost = new Map();  // "l:q" -> min isolate-cost this shape offers
        for (const r of rotShapes) {
            let filled = 0;
            const matched = [];
            for (let l = 0; l < r.numLayers; l++) {
                const rl = r.layers[l], tl = target.layers[l];
                const len = Math.max(rl ? rl.length : 0, tl ? tl.length : 0);
                for (let q = 0; q < len; q++) {
                    const rp = rl && rl[q], tp = tl && tl[q];
                    if (!rp || rp.shape === NOTHING_CHAR) continue;
                    filled++;
                    if (tp && tp.shape === rp.shape) matched.push(l + ':' + q);
                }
            }
            const conflicts = filled - matched.length;
            const cost = Math.min(3, conflicts);
            for (const key of matched) {
                const prev = slotCost.get(key);
                if (prev === undefined || cost < prev) slotCost.set(key, cost);
            }
            if (conflicts === 0 && matched.length > bestClean.length) bestClean = matched;
        }
        return { cleanSlots: bestClean, slotCost };
    }

    const matchCache = new Map();
    function getCachedMatch(shapeCode) {
        let m = matchCache.get(shapeCode);
        if (m !== undefined) return m;
        m = _matchAndCoverage(getCachedShape(shapeCode));
        matchCache.set(shapeCode, m);
        return m;
    }

    // All target slot keys, for the per-slot cost sum below.
    const targetSlotKeys = [];
    for (let l = 0; l < target.numLayers; l++) {
        for (let q = 0; q < target.layers[l].length; q++) {
            if (target.layers[l][q].shape !== NOTHING_CHAR) targetSlotKeys.push(l + ':' + q);
        }
    }

    // Estimated ops remaining, in real op-units: for each target slot, the cheapest way
    // any held shape can supply it (0 if a clean piece already covers it, up to 3 to
    // isolate, 4 to fabricate from scratch); plus 1 stack to merge each clean piece
    // beyond the first; plus 1 stack per still-missing layer. heuristicDivisor then
    // weights this estimate (weighted A*, W = 1/divisor; default 0.1 → 10×) so h
    // dominates g and the search descends the gradient greedily — essential at this
    // branching factor, where a near-admissible h explores far too broadly.
    function getHeuristic(availableIds) {
        if (availableIds.size === 0) return Infinity;

        const slotMin = new Map();  // target slot -> cheapest supply cost across held shapes
        let cleanPieces = 0;
        let maxLayerCount = 0;

        for (const id of availableIds) {
            const code = shapes.get(id);
            const shape = getCachedShape(code);
            if (shape.numLayers > maxLayerCount) maxLayerCount = shape.numLayers;
            const m = getCachedMatch(code);
            if (m.cleanSlots.length > 0) cleanPieces++;
            for (const [key, cost] of m.slotCost) {
                const prev = slotMin.get(key);
                if (prev === undefined || cost < prev) slotMin.set(key, cost);
            }
        }

        let h = Math.max(0, cleanPieces - 1) + Math.max(0, target.numLayers - maxLayerCount);
        for (const key of targetSlotKeys) {
            const c = slotMin.get(key);
            h += (c === undefined) ? 4 : c;  // 4 = no held shape has this part at all
        }

        if (preventWaste && availableIds.size > 1) {
            h += (availableIds.size - 1);  // At least 1 op per extra to incorporate/trash
        }

        return Math.ceil(h / heuristicDivisor);
    }

    // State score for BFS beam pruning: higher is kept. Uses the same coverage signal
    // as the A* heuristic (negated), so both methods favour states that hold clean
    // partial sub-shapes of the target over superficially-similar dead ends.
    function calculateStateScore(availableIds) {
        return -getHeuristic(availableIds);
    }

    // ---------------------------------------------------------------------------
    // Symmetry Canonicalization
    // ---------------------------------------------------------------------------
    const canonicalCache = new Map();

    function getCanonicalCode(shapeCode) {
        if (orientationSensitive) return shapeCode;
        let canonical = canonicalCache.get(shapeCode);
        if (canonical) return canonical;
        const rotations = getAllRotations(getCachedShape(shapeCode), config);
        canonical = Array.from(rotations).sort()[0];
        canonicalCache.set(shapeCode, canonical);
        return canonical;
    }

    // Build a state key (multiset of canonical codes) from raw codes — the visited
    // check is order-independent, so two states with the same shapes match.
    function stateKeyFromCodes(codes) {
        const countMap = {};
        for (const code of codes) {
            const canon = getCanonicalCode(code);
            countMap[canon] = (countMap[canon] || 0) + 1;
        }
        // Sorted "code:count" multiset, joined with '|'. Shape codes contain no
        // digits, so the trailing :<count> is always unambiguous, and '|' never
        // appears in a code — so this is an injective key, without JSON overhead.
        return Object.entries(countMap)
            .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
            .map(([code, count]) => code + ':' + count)
            .join('|');
    }

    function getStateKey(availableIds) {
        const codes = [];
        for (const id of availableIds) codes.push(shapes.get(id));
        return stateKeyFromCodes(codes);
    }

    // Resulting state key for a successor descriptor, computed from codes alone —
    // no shape ids minted, so successors the search rejects stay cheap (this is
    // what keeps the shapes Map from growing with every edge ever generated).
    function successorStateKey(parentAvailableIds, desc) {
        const codes = [];
        for (const id of parentAvailableIds) {
            if (desc.inputIds.includes(id)) continue;
            codes.push(shapes.get(id));
        }
        for (const code of desc.outputCodes) codes.push(code);
        return stateKeyFromCodes(codes);
    }

    // Materialize an accepted successor: mint ids for its outputs and build the
    // real available-set + step (with concrete input/output ids the graph needs).
    function applySuccessor(parentAvailableIds, desc) {
        const newAvailableIds = new Set(parentAvailableIds);
        for (const id of desc.inputIds) newAvailableIds.delete(id);
        const outputIds = [];
        for (const code of desc.outputCodes) {
            const newId = nextId++;
            shapes.set(newId, code);
            outputIds.push(newId);
            newAvailableIds.add(newId);
        }
        return {
            availableIds: newAvailableIds,
            step: { type: desc.type, inputIds: desc.inputIds, outputIds, color: desc.color }
        };
    }

    function isGoal(availableIds) {
        const shapeCodes = Array.from(availableIds).map(id => shapes.get(id));
        const hasTarget = shapeCodes.some(code => acceptable.has(code));
        const allTarget = preventWaste ? shapeCodes.every(code => acceptable.has(code)) : true;
        return hasTarget && allTarget;
    }

    // Generate all successor descriptors from a given state.
    // A descriptor is lightweight — { type, inputIds, outputCodes, color } — and
    // deliberately does NOT mint shape ids or build the new available-set. That is
    // deferred to applySuccessor() and only done for successors the caller actually
    // accepts, so rejected successors never grow the shapes Map (the old
    // unbounded-growth bug minted ids for every edge, kept or not).
    // Includes operation pruning and the operation-result cache.
    const expansionColorContext = {
        target,
        targetCrystalColors,
        getShape: getCachedShape,
    };
    const expansionPruning = {
        monolayerPainting,
        availableIdsSize: 0,
    };

    function* generateSuccessors(availableIds) {
        expansionPruning.availableIdsSize = availableIds.size;
        const referenceCodes = Array.from(availableIds).map(id => shapes.get(id));

        for (const opName of enabledOperations) {
            if (shouldCancel()) return;
            const op = operations[opName];
            if (!op) continue;
            const { inputCount, needsColor } = op;

            if (inputCount === 1) {
                for (const id of availableIds) {
                    if (shouldCancel()) return;
                    const inputCode = shapes.get(id);

                    if (opName === 'Trash') {
                        if (preventWaste && !acceptable.has(inputCode)) {
                            yield { type: opName, inputIds: [id], outputCodes: [], color: null };
                        }
                        continue;
                    }

                    const inputShape = getCachedShape(inputCode);
                    for (const desc of expandUnaryOp(opName, op, id, inputCode, inputShape, config, {
                        needsColor,
                        pruning: expansionPruning,
                        colorContext: { ...expansionColorContext, referenceCodes },
                        useCache: true,
                    })) {
                        yield desc;
                    }
                }
            } else if (inputCount === 2) {
                const ids = Array.from(availableIds);
                for (let i = 0; i < ids.length && !shouldCancel(); i++) {
                    for (let j = 0; j < ids.length && !shouldCancel(); j++) {
                        if (i === j) continue;
                        const id1 = ids[i];
                        const id2 = ids[j];
                        const inputCode1 = shapes.get(id1);
                        const inputCode2 = shapes.get(id2);
                        const desc = expandBinaryOp(
                            opName, op, id1, id2,
                            inputCode1, inputCode2,
                            getCachedShape(inputCode1), getCachedShape(inputCode2),
                            config, { useCache: true }
                        );
                        if (desc) yield desc;
                    }
                }
            }
        }
    }

    // Map an internal step record to a public solution-path entry. Shared by
    // reconstructPath (A*/Bidirectional/BFS, which walk a cameFrom chain) and the
    // IDA* goal case (which already holds a forward step array in frame.path).
    function formatStep(step) {
        return {
            operation: step.type,
            inputs: step.inputIds.map(id => ({id, shape: shapes.get(id)})),
            outputs: step.outputIds.map(id => ({id, shape: shapes.get(id)})),
            params: step.color ? {color: step.color} : {}
        };
    }

    function reconstructPath(cameFrom, goalKey, initialKey) {
        const solutionPath = [];
        let curKey = goalKey;
        while (curKey !== initialKey) {
            const {parentKey, step} = cameFrom.get(curKey);
            solutionPath.push(formatStep(step));
            curKey = parentKey;
        }
        solutionPath.reverse();
        return solutionPath;
    }

    // Shared best-first (A*/Bidirectional) search loop. A* and Bidirectional were
    // line-for-line identical apart from the heuristic function and the progress
    // label/suffix, so both call this with their own heuristicFn. `progressSuffix`
    // is appended to the per-iteration status line; `abortHint` to the cap message.
    async function runBestFirst(heuristicFn, label, progressSuffix, abortHint) {
        const open = new PriorityQueue();
        const costSoFar = new Map();
        const cameFrom = new Map();

        const initialKey = getStateKey(initialAvailableIds);
        costSoFar.set(initialKey, 0);
        open.enqueue({availableIds: new Set(initialAvailableIds), stateKey: initialKey}, 0 + heuristicFn(initialAvailableIds));

        let statesExplored = 0;

        while (open.size() > 0 && !shouldCancel()) {
            if (costSoFar.size > maxStates) { aborted = true; break; }
            const currentItem = open.dequeue();
            if (!currentItem) break;
            statesExplored++;

            const {availableIds, stateKey} = currentItem.val;
            const g = costSoFar.get(stateKey);

            if (isGoal(availableIds)) {
                return {
                    solutionPath: reconstructPath(cameFrom, stateKey, initialKey),
                    depth: g,
                    statesExplored
                };
            }

            for (const desc of generateSuccessors(availableIds)) {
                const newKey = successorStateKey(availableIds, desc);
                const newG = g + 1;
                if (!costSoFar.has(newKey) || newG < costSoFar.get(newKey)) {
                    costSoFar.set(newKey, newG);
                    const { availableIds: succIds, step } = applySuccessor(availableIds, desc);
                    const h = heuristicFn(succIds);
                    open.enqueue({availableIds: succIds, stateKey: newKey}, newG + h);
                    cameFrom.set(newKey, { parentKey: stateKey, step });
                }
            }

            if (statesExplored % 500 === 0 || performance.now() - lastUpdate > 200) {
                onProgress(`${label} | g=${g} | Open:${open.size()} | Explored:${statesExplored} | Total visited:${costSoFar.size}${progressSuffix}`);
                lastUpdate = performance.now();
                // Yield to the event loop so a long search stays cancellable, matching IDA*.
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (aborted) onProgress(`${label} | Aborted: hit ${maxStates}-state cap before solving${abortHint}`);
        return shouldCancel() ? null : {solutionPath: null, depth: null, statesExplored, aborted: aborted ? 'maxStates' : null};
    }

    // -----------------------------------------------------------------------
    // A* Search
    // -----------------------------------------------------------------------
    if (searchMethod === 'A*') {
        return await runBestFirst(getHeuristic, 'A*', '', ' (try BFS, a larger heuristic divisor, or a simpler target)');

    // -----------------------------------------------------------------------
    // IDA* Search
    // -----------------------------------------------------------------------
    } else if (searchMethod === 'IDA*') {

    let threshold = getHeuristic(initialAvailableIds);
    let statesExplored = 0;   // cumulative nodes expanded across all threshold passes
    let passCount = 0;        // number of threshold-bounded passes run so far

    while (!shouldCancel()) {
        passCount++;
        let nodesThisPass = 0;

        // Depth-limited search using explicit stack. pathKeys is a single mutable
        // Set holding the state keys currently on the stack (root → top): a key is
        // added when its frame is pushed and deleted when the frame is popped
        // (backtracking), so cycle detection stays O(depth) total instead of copying
        // the whole Set on every push. Cycle detection prevents a duplicate key from
        // being on the stack at once, so each delete-on-pop is unambiguous.
        const initialKey = getStateKey(initialAvailableIds);
        const pathKeys = new Set([initialKey]);
        const stack = [{
            availableIds: new Set(initialAvailableIds),
            g: 0,
            path: [],
            successorIterator: null,
            stateKey: initialKey
        }];

        let nextThreshold = Infinity;
        let found = false;
        let solutionPath = null;

        while (stack.length > 0 && !shouldCancel()) {
            const frame = stack[stack.length - 1];

            // A frame with no successorIterator is on its first visit: check its
            // goal/f-value, then lazily attach the iterator below. On later visits the
            // iterator is present, so this block is skipped and we pull the next
            // successor — the iterator's presence is what distinguishes a frame being
            // re-expanded from one being visited for the first time.
            if (!frame.successorIterator) {
                nodesThisPass++;
                statesExplored++;

                if (statesExplored > maxStates) { aborted = true; break; }

                const f = frame.g + getHeuristic(frame.availableIds);
                if (f > threshold) {
                    nextThreshold = Math.min(nextThreshold, f);
                    pathKeys.delete(frame.stateKey);
                    stack.pop();
                    continue;
                }

                if (isGoal(frame.availableIds)) {
                    solutionPath = frame.path.map(formatStep);
                    found = true;
                    break;
                }

                frame.successorIterator = generateSuccessors(frame.availableIds);
            }

            // Try next successor
            const next = frame.successorIterator.next();
            if (next.done) {
                pathKeys.delete(frame.stateKey);
                stack.pop();
                continue;
            }

            const desc = next.value;
            const succKey = successorStateKey(frame.availableIds, desc);

            // Cycle detection: skip if this state key is already on the path
            if (pathKeys.has(succKey)) continue;

            const { availableIds: succIds, step } = applySuccessor(frame.availableIds, desc);
            pathKeys.add(succKey);

            stack.push({
                availableIds: succIds,
                g: frame.g + 1,
                path: [...frame.path, step],
                successorIterator: null,
                stateKey: succKey
            });

            // Status update
            if (statesExplored % 1000 === 0 || performance.now() - lastUpdate > 200) {
                onProgress(`IDA* | Pass:${passCount} | Threshold:${threshold} | Nodes:${nodesThisPass} | Stack:${stack.length} | Total:${statesExplored}`);
                lastUpdate = performance.now();
                // Yield to event loop periodically for cancel checks
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (found) {
            return { solutionPath, depth: solutionPath.length, statesExplored: statesExplored };
        }

        if (aborted) {
            onProgress(`IDA* | Aborted: hit ${maxStates}-node cap before solving`);
            return { solutionPath: null, depth: null, statesExplored: statesExplored, aborted: 'maxStates' };
        }

        if (nextThreshold === Infinity || shouldCancel()) {
            return shouldCancel() ? null : { solutionPath: null, depth: null, statesExplored: statesExplored };
        }

        onProgress(`IDA* | Increasing threshold: ${threshold} → ${nextThreshold} | Total nodes: ${statesExplored}`);

        threshold = nextThreshold;
    }

    return shouldCancel() ? null : { solutionPath: null, depth: null, statesExplored: statesExplored };

    // -----------------------------------------------------------------------
    // Bidirectional Search
    // -----------------------------------------------------------------------
    } else if (searchMethod === 'Bidirectional') {

    // Phase 1: Build backward reachability map
    onProgress('Bidirectional | Building backward reachability map...');
    const backwardDepth = BIDIRECTIONAL_BACKWARD_DEPTH;
    const backwardMap = buildBackwardReachability(targetShapeCode, config, enabledOperations, backwardDepth, shouldCancel);
    if (shouldCancel()) return null;

    onProgress(`Bidirectional | Backward map: ${backwardMap.size} reachable shapes (depth ${backwardDepth})`);

    // Phase 2: Forward A* with enhanced heuristic
    function getHeuristicBidirectional(availableIds) {
        if (availableIds.size === 0) return Infinity;

        // Check if any shape is in the backward map
        let bestBackwardDist = Infinity;
        for (const id of availableIds) {
            const code = shapes.get(id);
            if (backwardMap.has(code)) {
                bestBackwardDist = Math.min(bestBackwardDist, backwardMap.get(code));
            }
        }

        if (bestBackwardDist < Infinity) {
            // Use backward distance as heuristic (exact for shapes in the map)
            let h = bestBackwardDist;
            if (preventWaste && availableIds.size > 1) {
                h += (availableIds.size - 1);
            }
            return h;
        }

        // Fallback to standard heuristic
        return getHeuristic(availableIds);
    }

    return await runBestFirst(
        getHeuristicBidirectional,
        'Bidirectional',
        ` | Backward map:${backwardMap.size}`,
        ''
    );

    // -----------------------------------------------------------------------
    // BFS (original)
    // -----------------------------------------------------------------------
    } else {
    const initialKey = getStateKey(initialAvailableIds);
    const queue = [{ availableIds: initialAvailableIds, stateKey: initialKey, depth: 0, score: calculateStateScore(initialAvailableIds) }];
    const visited = new Set();
    visited.add(initialKey);
    // cameFrom maps each discovered state key to its parent key + the step that
    // produced it, so the solution path is reconstructed once at the goal (same
    // pattern as A*/Bidirectional) instead of copying a full path array onto every
    // accepted successor. Pruned states leave harmless unused entries — only the
    // goal's ancestor chain (all survivors) is ever walked.
    const cameFrom = new Map();
    // Beam pruning: when a depth level exceeds the cap, keep only the
    // highest-scoring states (calculateStateScore favours clean partial pieces).
    function pruneStatesAtDepth(states, maxStates) {
        if (states.length <= maxStates) {
            return states;
        }
        states.sort((a, b) => b.score - a.score);
        return states.slice(0, maxStates);
    }
    while (queue.length > 0 && !shouldCancel()) {
        if (visited.size > maxStates) { aborted = true; break; }
        const currentDepthStates = [];
        while (queue.length > 0 && queue[0].depth === depth) {
            currentDepthStates.push(queue.shift());
        }
        const nextDepthStates = [];
        for (const current of currentDepthStates) {
            if (shouldCancel()) break;
            const availableIds = current.availableIds;
            const currentKey = current.stateKey;
            if (isGoal(availableIds)) {
                return {
                    solutionPath: reconstructPath(cameFrom, currentKey, initialKey),
                    depth,
                    statesExplored: visited.size
                };
            }
            for (const desc of generateSuccessors(availableIds)) {
                if (shouldCancel()) break;
                const stateKey = successorStateKey(availableIds, desc);
                if (!visited.has(stateKey)) {
                    visited.add(stateKey);
                    const { availableIds: succIds, step } = applySuccessor(availableIds, desc);
                    cameFrom.set(stateKey, { parentKey: currentKey, step });
                    const newScore = calculateStateScore(succIds);
                    nextDepthStates.push({ availableIds: succIds, stateKey, depth: depth + 1, score: newScore });
                }
            }
        }
        const prunedNextStates = pruneStatesAtDepth(nextDepthStates, maxStatesPerLevel);
        for (const state of prunedNextStates) {
            queue.push(state);
        }
        if (queue.length > 0) {
            depth = queue[0].depth;
        }
        const now = performance.now();
        if (now - lastUpdate > 200) {
            const prunedCount = nextDepthStates.length - prunedNextStates.length;
            const pruneInfo = prunedCount > 0 ? ` | Pruned ${prunedCount} States` : '';
            onProgress(`BFS | Depth ${depth} → ${queue.length} States | ${visited.size} Total States${pruneInfo}`);
            lastUpdate = now;
        }
    }
    if (aborted) onProgress(`BFS | Aborted: hit ${maxStates}-state cap before solving`);
    return shouldCancel() ? null : {solutionPath: null, depth: null, statesExplored: visited.size, aborted: aborted ? 'maxStates' : null};
    }
}
