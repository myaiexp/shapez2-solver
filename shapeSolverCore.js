import {
    Shape, ShapeOperationConfig, NOTHING_CHAR,
    _getAllRotations, _getPaintColors, _getCrystalColors, _getSimilarity,
    halfCut, cut, swapHalves, rotate90CW, rotate90CCW, rotate180, stack, topPaint, pushPin, genCrystal, trash, beltSplit
} from './shapeOperations.js';
import { PriorityQueue } from './shapeSolverPriorityQueue.js';
import {
    shapeCache,
    operationResultCache,
    getCachedShape,
    getCachedOpResult1,
    getCachedOpResult1Color,
    getCachedOpResult2
} from './shapeSolverCache.js';
import { buildBackwardReachability } from './shapeSolverBackward.js';

export const operations = {
    "Rotator CW": { fn: rotate90CW, inputCount: 1 },
    "Rotator CCW": { fn: rotate90CCW, inputCount: 1 },
    "Rotator 180": { fn: rotate180, inputCount: 1 },
    "Half Destroyer": { fn: halfCut, inputCount: 1 },
    "Cutter": { fn: cut, inputCount: 1 },
    "Swapper": { fn: swapHalves, inputCount: 2 },
    "Stacker": { fn: stack, inputCount: 2 },
    "Painter": { fn: topPaint, inputCount: 1, needsColor: true },
    "Pin Pusher": { fn: pushPin, inputCount: 1 },
    "Crystal Generator": { fn: genCrystal, inputCount: 1, needsColor: true },
    "Trash": { fn: trash, inputCount: 1 },
    "Belt Split": { fn: beltSplit, inputCount: 1 }
};

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
    // Hard ceiling on distinct states discovered. Hard targets (e.g. alternating
    // quadrants like CuRuCuRu) have an effectively unbounded state space; without
    // this the search OOMs. On the cap the search aborts gracefully and returns
    // { ..., aborted: 'maxStates' } instead of running the process out of memory.
    maxStates = 500000
) {
    // Clear caches between solves to prevent unbounded memory growth
    shapeCache.clear();
    operationResultCache.clear();

    const target = getCachedShape(targetShapeCode);
    const targetCrystalColors = _getCrystalColors(target);
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
        const rotations = _getAllRotations(target, config);
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

    const maxPossibleSim = _getSimilarity(target, target);  // Precompute once

    // ---------------------------------------------------------------------------
    // Optimization 2: Similarity-to-Target Cache
    // ---------------------------------------------------------------------------
    const similarityCache = new Map();

    function getCachedSimilarity(shapeCode) {
        let sim = similarityCache.get(shapeCode);
        if (sim !== undefined) return sim;

        const shape = getCachedShape(shapeCode);
        sim = _getSimilarity(shape, target);
        if (!orientationSensitive) {
            const rotCodes = _getAllRotations(shape, config);
            for (const rcode of rotCodes) {
                sim = Math.max(sim, _getSimilarity(getCachedShape(rcode), target));
            }
        }
        similarityCache.set(shapeCode, sim);
        return sim;
    }

    function getHeuristic(availableIds) {
        if (availableIds.size === 0) return Infinity;

        let bestSim = 0;
        let maxL = 0;

        for (const id of availableIds) {
            const shapeCode = shapes.get(id);
            const shape = getCachedShape(shapeCode);
            maxL = Math.max(maxL, shape.numLayers);
            bestSim = Math.max(bestSim, getCachedSimilarity(shapeCode));
        }

        let h = 0;
        // Layer penalty (strict lower bound: at least this many stacks needed)
        h += Math.max(0, target.numLayers - maxL);

        // Mismatch penalty (admissible: no op fixes >heuristicDivisor "similarity points")
        h += Math.ceil((maxPossibleSim - bestSim) / heuristicDivisor);

        // Optional extra-shape penalty when preventWaste (conservative lower bound)
        if (preventWaste && availableIds.size > 1) {
            h += (availableIds.size - 1);  // At least 1 op per extra to incorporate/trash
        }

        return h;
    }

    // Function to calculate similarity score for a state (used by BFS)
    function calculateStateScore(availableIds) {
        let totalSimilarity = 0;
        let count = 0;
        for (const id of availableIds) {
            totalSimilarity += getCachedSimilarity(shapes.get(id));
            count++;
        }
        return count > 0 ? totalSimilarity / count : 0;
    }

    // ---------------------------------------------------------------------------
    // Optimization 4: Symmetry Canonicalization
    // ---------------------------------------------------------------------------
    const canonicalCache = new Map();

    function getCanonicalCode(shapeCode) {
        if (orientationSensitive) return shapeCode;
        let canonical = canonicalCache.get(shapeCode);
        if (canonical) return canonical;
        const rotations = _getAllRotations(getCachedShape(shapeCode), config);
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
        return JSON.stringify(Object.entries(countMap).sort());
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

    // Goal check helper
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
    // Includes Optimization 5 (operation pruning) and Optimization 7 (operation result cache)
    function* generateSuccessors(availableIds) {
        for (const opName of enabledOperations) {
            if (shouldCancel()) return;
            const op = operations[opName];
            if (!op) continue;
            const { fn, inputCount, needsColor } = op;

            if (inputCount === 1) {
                for (const id of availableIds) {
                    if (shouldCancel()) return;
                    const inputCode = shapes.get(id);
                    const inputShape = getCachedShape(inputCode);

                    // --- Optimization 5: Operation Pruning ---

                    // Skip trashing the last shape (always useless)
                    if (opName === 'Trash' && availableIds.size === 1) continue;

                    // Skip rotation of rotationally symmetric shapes
                    if (opName === 'Rotator CW' || opName === 'Rotator CCW' || opName === 'Rotator 180') {
                        const rotations = _getAllRotations(inputShape, config);
                        if (rotations.size === 1) continue; // fully symmetric
                        if (opName === 'Rotator 180' && rotations.size <= 2) continue; // 180° symmetric
                    }

                    // Skip cutting shapes where one half is already empty
                    if (opName === 'Cutter' || opName === 'Half Destroyer') {
                        const layer = inputShape.layers[0];
                        const half = Math.floor(inputShape.numParts / 2);
                        const leftEmpty = layer.slice(0, half).every(p => p.shape === NOTHING_CHAR);
                        const rightEmpty = layer.slice(half).every(p => p.shape === NOTHING_CHAR);
                        if (leftEmpty || rightEmpty) continue;
                    }

                    // --- End Pruning ---

                    if (needsColor) {
                        if (monolayerPainting && opName === "Painter" && inputShape.layers.length !== 1) {
                            continue;
                        }
                        const colors = opName === "Painter" ? _getPaintColors(inputShape, target) : targetCrystalColors;
                        for (const color of colors) {
                            const outputs = getCachedOpResult1Color(opName, fn, inputShape, color, config);
                            const outputCodes = [];
                            for (const outputShape of outputs) {
                                if (outputShape.isEmpty()) continue;
                                const outCode = outputShape.toShapeCode();
                                if (outCode === inputCode) continue; // skip no-op: output same as input
                                outputCodes.push(outCode);
                            }
                            if (outputCodes.length > 0) {
                                yield { type: opName, inputIds: [id], outputCodes, color };
                            }
                        }
                    } else {
                        const outputs = getCachedOpResult1(opName, fn, inputShape, config);
                        const outputCodes = [];
                        for (const outputShape of outputs) {
                            if (outputShape.isEmpty()) continue;
                            const outCode = outputShape.toShapeCode();
                            if (outCode === inputCode) continue; // skip no-op: output same as input
                            outputCodes.push(outCode);
                        }
                        if (outputCodes.length > 0) {
                            yield { type: opName, inputIds: [id], outputCodes, color: null };
                        }
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
                        const inputShape1 = getCachedShape(inputCode1);
                        const inputShape2 = getCachedShape(inputCode2);
                        const outputs = getCachedOpResult2(opName, fn, inputShape1, inputShape2, config);
                        const outputCodes = [];
                        let isNoOp = true;
                        for (const outputShape of outputs) {
                            if (outputShape.isEmpty()) continue;
                            const outCode = outputShape.toShapeCode();
                            if (outCode !== inputCode1 && outCode !== inputCode2) isNoOp = false;
                            outputCodes.push(outCode);
                        }
                        // Skip no-op: all outputs identical to inputs
                        if (isNoOp && outputCodes.length === 2) continue;
                        if (outputCodes.length > 0) {
                            yield { type: opName, inputIds: [id1, id2], outputCodes, color: null };
                        }
                    }
                }
            }
        }
    }

    // Build solution path from cameFrom chain
    function reconstructPath(cameFrom, goalKey, initialKey) {
        const solutionPath = [];
        let curKey = goalKey;
        while (curKey !== initialKey) {
            const {parentKey, step} = cameFrom.get(curKey);
            solutionPath.push({
                operation: step.type,
                inputs: step.inputIds.map(id => ({id, shape: shapes.get(id)})),
                outputs: step.outputIds.map(id => ({id, shape: shapes.get(id)})),
                params: step.color ? {color: step.color} : {}
            });
            curKey = parentKey;
        }
        solutionPath.reverse();
        return solutionPath;
    }

    // -----------------------------------------------------------------------
    // A* Search
    // -----------------------------------------------------------------------
    if (searchMethod === 'A*') {
    const open = new PriorityQueue();
    const costSoFar = new Map();
    const cameFrom = new Map();

    const initialKey = getStateKey(initialAvailableIds);
    costSoFar.set(initialKey, 0);
    open.enqueue({availableIds: new Set(initialAvailableIds), stateKey: initialKey}, 0 + getHeuristic(initialAvailableIds));

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
                const h = getHeuristic(succIds);
                open.enqueue({availableIds: succIds, stateKey: newKey}, newG + h);
                cameFrom.set(newKey, { parentKey: stateKey, step });
            }
        }

        if (statesExplored % 500 === 0 || performance.now() - lastUpdate > 200) {
            onProgress(`A* | g=${g} | Open:${open.size()} | Explored:${statesExplored} | Total visited:${costSoFar.size}`);
            lastUpdate = performance.now();
        }
    }

    if (aborted) onProgress(`A* | Aborted: hit ${maxStates}-state cap before solving (try BFS, a larger heuristic divisor, or a simpler target)`);
    return shouldCancel() ? null : {solutionPath: null, depth: null, statesExplored, aborted: aborted ? 'maxStates' : null};

    // -----------------------------------------------------------------------
    // IDA* Search (Optimization 8)
    // -----------------------------------------------------------------------
    } else if (searchMethod === 'IDA*') {

    let threshold = getHeuristic(initialAvailableIds);
    let totalIterations = 0;
    let iterationCount = 0;

    while (!shouldCancel()) {
        iterationCount++;
        let nodesExplored = 0;

        // Depth-limited search using explicit stack
        const stack = [{
            availableIds: new Set(initialAvailableIds),
            g: 0,
            path: [],
            successorIterator: null,
            pathKeys: new Set([getStateKey(initialAvailableIds)])
        }];

        let nextThreshold = Infinity;
        let found = false;
        let solutionPath = null;

        while (stack.length > 0 && !shouldCancel()) {
            const frame = stack[stack.length - 1];

            // First visit to this frame: check goal and f-value
            if (!frame.successorIterator) {
                nodesExplored++;
                totalIterations++;

                if (totalIterations > maxStates) { aborted = true; break; }

                const f = frame.g + getHeuristic(frame.availableIds);
                if (f > threshold) {
                    nextThreshold = Math.min(nextThreshold, f);
                    stack.pop();
                    continue;
                }

                if (isGoal(frame.availableIds)) {
                    solutionPath = frame.path.map(step => ({
                        operation: step.type,
                        inputs: step.inputIds.map(id => ({id, shape: shapes.get(id)})),
                        outputs: step.outputIds.map(id => ({id, shape: shapes.get(id)})),
                        params: step.color ? {color: step.color} : {}
                    }));
                    found = true;
                    break;
                }

                frame.successorIterator = generateSuccessors(frame.availableIds);
            }

            // Try next successor
            const next = frame.successorIterator.next();
            if (next.done) {
                stack.pop();
                continue;
            }

            const desc = next.value;
            const succKey = successorStateKey(frame.availableIds, desc);

            // Cycle detection: skip if this state key is already on the path
            if (frame.pathKeys.has(succKey)) continue;

            const { availableIds: succIds, step } = applySuccessor(frame.availableIds, desc);
            const newPathKeys = new Set(frame.pathKeys);
            newPathKeys.add(succKey);

            stack.push({
                availableIds: succIds,
                g: frame.g + 1,
                path: [...frame.path, step],
                successorIterator: null,
                pathKeys: newPathKeys
            });

            // Status update
            if (totalIterations % 1000 === 0 || performance.now() - lastUpdate > 200) {
                onProgress(`IDA* | Iter:${iterationCount} | Threshold:${threshold} | Nodes:${nodesExplored} | Stack:${stack.length} | Total:${totalIterations}`);
                lastUpdate = performance.now();
                // Yield to event loop periodically for cancel checks
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (found) {
            return { solutionPath, depth: solutionPath.length, statesExplored: totalIterations };
        }

        if (aborted) {
            onProgress(`IDA* | Aborted: hit ${maxStates}-node cap before solving`);
            return { solutionPath: null, depth: null, statesExplored: totalIterations, aborted: 'maxStates' };
        }

        if (nextThreshold === Infinity || shouldCancel()) {
            return shouldCancel() ? null : { solutionPath: null, depth: null, statesExplored: totalIterations };
        }

        onProgress(`IDA* | Increasing threshold: ${threshold} → ${nextThreshold} | Total nodes: ${totalIterations}`);

        threshold = nextThreshold;
    }

    return shouldCancel() ? null : { solutionPath: null, depth: null, statesExplored: totalIterations };

    // -----------------------------------------------------------------------
    // Bidirectional Search (Optimization 3)
    // -----------------------------------------------------------------------
    } else if (searchMethod === 'Bidirectional') {

    // Phase 1: Build backward reachability map
    onProgress('Bidirectional | Building backward reachability map...');
    const backwardDepth = 4;
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

    const open = new PriorityQueue();
    const costSoFar = new Map();
    const cameFrom = new Map();

    const initialKey = getStateKey(initialAvailableIds);
    costSoFar.set(initialKey, 0);
    open.enqueue(
        {availableIds: new Set(initialAvailableIds), stateKey: initialKey},
        0 + getHeuristicBidirectional(initialAvailableIds)
    );

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
                const h = getHeuristicBidirectional(succIds);
                open.enqueue({availableIds: succIds, stateKey: newKey}, newG + h);
                cameFrom.set(newKey, { parentKey: stateKey, step });
            }
        }

        if (statesExplored % 500 === 0 || performance.now() - lastUpdate > 200) {
            onProgress(`Bidirectional | g=${g} | Open:${open.size()} | Explored:${statesExplored} | Total visited:${costSoFar.size} | Backward map:${backwardMap.size}`);
            lastUpdate = performance.now();
        }
    }

    if (aborted) onProgress(`Bidirectional | Aborted: hit ${maxStates}-state cap before solving`);
    return shouldCancel() ? null : {solutionPath: null, depth: null, statesExplored, aborted: aborted ? 'maxStates' : null};

    // -----------------------------------------------------------------------
    // BFS (original)
    // -----------------------------------------------------------------------
    } else {
    const queue = [{ availableIds: initialAvailableIds, path: [], depth: 0, score: calculateStateScore(initialAvailableIds) }];
    const visited = new Set();
    visited.add(getStateKey(initialAvailableIds));
    // Function to prune states at current depth level
    function pruneStatesAtDepth(states, maxStates) {
        if (states.length <= maxStates) {
            return states;
        }
        // Sort by score (higher is better)
        states.sort((a, b) => b.score - a.score);
        // Keep only the top maxStates
        return states.slice(0, maxStates);
    }
    // Solver loop
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
            const path = current.path;
            // Check if goal is reached
            if (isGoal(availableIds)) {
                const solutionPath = path.map(step => ({
                    operation: step.type,
                    inputs: step.inputIds.map(id => ({ id, shape: shapes.get(id) })),
                    outputs: step.outputIds.map(id => ({ id, shape: shapes.get(id) })),
                    params: step.color ? { color: step.color } : {}
                }));
                return {
                    solutionPath,
                    depth,
                    statesExplored: visited.size
                };
            }
            // Generate next states
            for (const desc of generateSuccessors(availableIds)) {
                if (shouldCancel()) break;
                const stateKey = successorStateKey(availableIds, desc);
                if (!visited.has(stateKey)) {
                    visited.add(stateKey);
                    const { availableIds: succIds, step } = applySuccessor(availableIds, desc);
                    const newPath = [...path, step];
                    const newScore = calculateStateScore(succIds);
                    nextDepthStates.push({ availableIds: succIds, path: newPath, depth: depth + 1, score: newScore });
                }
            }
        }
        // Prune states for next depth level
        const prunedNextStates = pruneStatesAtDepth(nextDepthStates, maxStatesPerLevel);
        // Add pruned states back to queue
        for (const state of prunedNextStates) {
            queue.push(state);
        }
        // Move to next depth level
        if (queue.length > 0) {
            depth = queue[0].depth;
        }
        // Periodic status update
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

export async function shapeExplorer(
    startingShapeCodes,
    enabledOperations,
    depthLimit,
    maxLayers,
    shouldCancel = () => false,
    onProgress = () => {}
) {
    const config = new ShapeOperationConfig(maxLayers);

    let nextShapeId = 0;
    let nextOpId = 0;
    const shapeCodeToId = new Map();
    const shapesList = [];
    const opsList = [];
    const edges = [];

    function addShapeIfNew(code) {
        if (!shapeCodeToId.has(code)) {
            const id = nextShapeId++;
            shapeCodeToId.set(code, id);
            shapesList.push({ id, code });
            return { id, added: true };
        }
        return { id: shapeCodeToId.get(code), added: false };
    }

    function getShapeById(id) {
        return Shape.fromShapeCode(shapesList.find(s => s.id === id).code);
    }

    const availableIds = new Set();
    for (const code of startingShapeCodes) {
        const { id } = addShapeIfNew(code);
        availableIds.add(id);
    }

    let frontier = new Set(availableIds);

    for (let depth = 1; depth <= depthLimit; depth++) {
        if (shouldCancel()) {
            return null;
        }

        const newlyDiscovered = new Set();
        const startIds = Array.from(availableIds); // All shapes found so far
        const primaryIds = Array.from(frontier); // Shapes from previous depth

        if (primaryIds.length === 0) break;

        for (const opName of enabledOperations) {
            if (shouldCancel()) {
                return null;
            }

            const op = operations[opName];
            if (!op) continue;

            const { fn, inputCount, needsColor } = op;

            if (inputCount === 1) {
                for (const id of primaryIds) {
                    if (shouldCancel()) break;

                    const inputShape = getShapeById(id);
                    if (inputShape.isEmpty()) continue;
                    const colors = needsColor ? ["r"] : [null];

                    for (const color of colors) {
                        if (shouldCancel()) break;

                        const outputs = needsColor ? fn(inputShape, color, config) : fn(inputShape, config);
                        const outputCodes = outputs.map(o => o.toShapeCode()).filter(Boolean);

                        if (outputCodes.some(oc => oc === shapesList[id].code)) {
                            continue;
                        }

                        const opId = `op-${nextOpId++}`;
                        opsList.push({ id: opId, type: opName, params: color ? { color } : {} });
                        edges.push({ source: `shape-${id}`, target: opId });

                        for (const oc of outputCodes) {
                            const { id: outId, added } = addShapeIfNew(oc);
                            if (outId === null) continue;
                            if (added) {
                                availableIds.add(outId);
                                newlyDiscovered.add(outId);
                            }
                            edges.push({ source: opId, target: `shape-${outId}` });
                        }
                    }
                }
            } else if (inputCount === 2) {
                const isStacker = opName === "Stacker";

                for (const id1 of startIds) {
                    if (shouldCancel()) break;

                    const s1 = getShapeById(id1);
                    if (s1.isEmpty()) continue;

                    for (const id2 of primaryIds) {
                        if (shouldCancel()) break;

                        if (id1 === id2 && !isStacker) continue;
                        if (id1 > id2 && !isStacker) continue;

                        const s2 = getShapeById(id2);
                        if (s2.isEmpty()) continue;

                        // Extra check for Stacker: compare outputs for both orders
                        if (isStacker && id1 !== id2) {
                            const outA = fn(getShapeById(id1), getShapeById(id2), config)
                                .map(o => o.toShapeCode()).filter(Boolean);
                            const outB = fn(getShapeById(id2), getShapeById(id1), config)
                                .map(o => o.toShapeCode()).filter(Boolean);

                            // If same outputs, only process one ordering (id1 < id2)
                            if (JSON.stringify(outA) === JSON.stringify(outB) && id1 > id2) {
                                continue;
                            }
                        }

                        const outputs = fn(getShapeById(id1), getShapeById(id2), config);
                        const outputCodes = outputs.map(o => o.toShapeCode()).filter(Boolean);

                        const code1 = shapesList[id1].code;
                        const code2 = shapesList[id2].code;

                        if (outputCodes.some(oc => oc === code1 || oc === code2)) {
                            continue;
                        }

                        const opId = `op-${nextOpId++}`;
                        opsList.push({ id: opId, type: opName, params: {} });
                        edges.push({ source: `shape-${id1}`, target: opId });
                        edges.push({ source: `shape-${id2}`, target: opId });

                        for (const oc of outputCodes) {
                            const { id: outId, added } = addShapeIfNew(oc);
                            if (outId === null) continue;
                            if (added) {
                                availableIds.add(outId);
                                newlyDiscovered.add(outId);
                            }
                            edges.push({ source: opId, target: `shape-${outId}` });
                        }
                    }
                }
            }
        }
        frontier = newlyDiscovered;
    }

    if (!shouldCancel()) {
        const shapesNodes = shapesList.map(s => ({ id: `shape-${s.id}`, code: s.code }));
        onProgress(`Exploration complete. Shapes: ${shapesNodes.length}, Ops: ${opsList.length}`);
        return { shapes: shapesNodes, ops: opsList, edges };
    }

    return null;
}
