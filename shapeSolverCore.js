import {
    Shape, ShapeOperationConfig, ShapePart, NOTHING_CHAR, SHAPE_LAYER_SEPARATOR,
    UNPAINTABLE_SHAPES,
    _getAllRotations, _getPaintColors, _getCrystalColors, _getSimilarity,
    halfCut, cut, swapHalves, rotate90CW, rotate90CCW, rotate180, stack, topPaint, pushPin, genCrystal, trash, beltSplit
} from './shapeOperations.js';

class PriorityQueue {
    constructor() {
        this.values = [];
    }
    enqueue(val, priority) {
        this.values.push({val, priority});
        this.bubbleUp();
    }
    bubbleUp() {
        let idx = this.values.length - 1;
        const element = this.values[idx];
        while (idx > 0) {
            let parentIdx = Math.floor((idx - 1) / 2);
            let parent = this.values[parentIdx];
            if (element.priority >= parent.priority) break;
            this.values[parentIdx] = element;
            this.values[idx] = parent;
            idx = parentIdx;
        }
    }
    dequeue() {
        if (this.values.length === 0) return null;
        const min = this.values[0];
        const end = this.values.pop();
        if (this.values.length > 0) {
            this.values[0] = end;
            this.sinkDown();
        }
        return min;
    }
    sinkDown() {
        let idx = 0;
        const length = this.values.length;
        const element = this.values[0];
        while (true) {
            let leftIdx = 2 * idx + 1;
            let rightIdx = 2 * idx + 2;
            let left, right;
            let swap = null;
            if (leftIdx < length) {
                left = this.values[leftIdx];
                if (left.priority < element.priority) swap = leftIdx;
            }
            if (rightIdx < length) {
                right = this.values[rightIdx];
                if ((swap !== null && right.priority < left.priority) || (swap === null && right.priority < element.priority)) {
                    swap = rightIdx;
                }
            }
            if (swap === null) break;
            this.values[idx] = this.values[swap];
            this.values[swap] = element;
            idx = swap;
        }
    }
    size() {
        return this.values.length;
    }
}

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
// Optimization 1: Shape Parsing Cache
// ---------------------------------------------------------------------------
const shapeCache = new Map();

function getCachedShape(code) {
    let shape = shapeCache.get(code);
    if (!shape) {
        shape = Shape.fromShapeCode(code);
        shapeCache.set(code, shape);
    }
    return shape;
}

// ---------------------------------------------------------------------------
// Optimization 7: Operation Result Cache
// ---------------------------------------------------------------------------
const operationResultCache = new Map();

function getCachedOpResult1(opName, fn, inputShape, config) {
    const key = `${opName}|${inputShape.toShapeCode()}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape, config);
        operationResultCache.set(key, result);
    }
    return result;
}

function getCachedOpResult1Color(opName, fn, inputShape, color, config) {
    const key = `${opName}|${inputShape.toShapeCode()}|${color}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape, color, config);
        operationResultCache.set(key, result);
    }
    return result;
}

function getCachedOpResult2(opName, fn, inputShape1, inputShape2, config) {
    const key = `${opName}|${inputShape1.toShapeCode()}|${inputShape2.toShapeCode()}`;
    let result = operationResultCache.get(key);
    if (!result) {
        result = fn(inputShape1, inputShape2, config);
        operationResultCache.set(key, result);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Inverse operations for backward search (Optimization 3)
// ---------------------------------------------------------------------------

/**
 * Unpaint: set all paintable parts on the top layer to uncolored.
 * Returns an array of shape codes (one per possible original color).
 */
function inverseUnpaint(shape, config) {
    const results = [];
    const topLayer = shape.layers[shape.layers.length - 1];
    // Check if top layer has any painted parts
    const hasPainted = topLayer.some(p =>
        !UNPAINTABLE_SHAPES.includes(p.shape) && p.color !== 'u'
    );
    if (!hasPainted) return results;

    // Generate the unpainted version
    const newLayers = shape.layers.map((layer, li) => {
        if (li === shape.layers.length - 1) {
            return layer.map(p => {
                if (!UNPAINTABLE_SHAPES.includes(p.shape) && p.color !== 'u') {
                    return new ShapePart(p.shape, 'u');
                }
                return p;
            });
        }
        return layer;
    });
    const unpainted = new Shape(newLayers);
    const code = unpainted.toShapeCode();
    if (code) results.push(code);
    return results;
}

/**
 * Unrotate CW: apply CCW rotation to get predecessor.
 */
function inverseRotateCW(shape, config) {
    const results = rotate90CCW(shape, config);
    return results.filter(s => !s.isEmpty()).map(s => s.toShapeCode());
}

/**
 * Unrotate CCW: apply CW rotation to get predecessor.
 */
function inverseRotateCCW(shape, config) {
    const results = rotate90CW(shape, config);
    return results.filter(s => !s.isEmpty()).map(s => s.toShapeCode());
}

/**
 * Unrotate 180: apply 180 rotation (self-inverse).
 */
function inverseRotate180(shape, config) {
    const results = rotate180(shape, config);
    return results.filter(s => !s.isEmpty()).map(s => s.toShapeCode());
}

/**
 * Unstack: decompose a multi-layer shape into (bottom, top) pairs.
 * For each split point, yield the bottom layers and top layers as separate shapes.
 */
function inverseUnstack(shape, config) {
    const results = [];
    if (shape.numLayers < 2) return results;

    for (let splitAt = 1; splitAt < shape.numLayers; splitAt++) {
        const bottomLayers = shape.layers.slice(0, splitAt);
        const topLayers = shape.layers.slice(splitAt);

        const bottomCode = bottomLayers.map(layer =>
            layer.map(p => p.shape + p.color).join('')
        ).join(SHAPE_LAYER_SEPARATOR);

        const topCode = topLayers.map(layer =>
            layer.map(p => p.shape + p.color).join('')
        ).join(SHAPE_LAYER_SEPARATOR);

        results.push(bottomCode, topCode);
    }
    return results;
}

/**
 * Uncut: the shape is one half of a cut result. Generate possible whole shapes
 * by pairing with an empty half or a mirrored copy.
 */
function inverseUncut(shape, config) {
    const results = [];
    if (shape.numLayers !== 1) return results;

    const numParts = shape.numParts;
    const half = Math.floor(numParts / 2);
    const layer = shape.layers[0];

    // Check if this is a left half (right side empty) or right half (left side empty)
    const leftEmpty = layer.slice(0, half).every(p => p.shape === NOTHING_CHAR);
    const rightEmpty = layer.slice(half).every(p => p.shape === NOTHING_CHAR);

    if (rightEmpty) {
        // This was the left output of a cut — the original had these parts on the left
        // and anything on the right
        const wholeParts = layer.map((p, i) => i < half ? p : new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        // Just stacking with empty right gives us back
        const wholeCode = wholeParts.map(p => p.shape + p.color).join('');
        results.push(wholeCode);
    }
    if (leftEmpty) {
        // This was the right output
        const wholeParts = layer.map((p, i) => i >= half ? p : new ShapePart(NOTHING_CHAR, NOTHING_CHAR));
        const wholeCode = wholeParts.map(p => p.shape + p.color).join('');
        results.push(wholeCode);
    }

    return results;
}

/**
 * Unpin: remove bottom pin layer if present.
 */
function inverseUnpin(shape, config) {
    const results = [];
    if (shape.numLayers < 2) return results;

    const bottomLayer = shape.layers[0];
    const allPins = bottomLayer.every(p => p.shape === 'P' || p.shape === NOTHING_CHAR);
    const hasPins = bottomLayer.some(p => p.shape === 'P');
    if (allPins && hasPins) {
        const remainingLayers = shape.layers.slice(1);
        const code = remainingLayers.map(layer =>
            layer.map(p => p.shape + p.color).join('')
        ).join(SHAPE_LAYER_SEPARATOR);
        results.push(code);
    }
    return results;
}

/**
 * Build backward reachability map from target shape code.
 * Returns Map<shapeCode, depth> of all shapes that can produce the target
 * within maxDepth inverse operations.
 */
function buildBackwardReachability(targetShapeCode, config, enabledOperations, maxDepth, shouldCancel) {
    const reachable = new Map(); // shapeCode -> depth
    reachable.set(targetShapeCode, 0);
    let frontier = [targetShapeCode];

    // Map enabled operations to their inverse functions
    const inverseOps = [];
    for (const opName of enabledOperations) {
        if (opName === 'Painter') inverseOps.push(inverseUnpaint);
        if (opName === 'Rotator CW') inverseOps.push(inverseRotateCW);
        if (opName === 'Rotator CCW') inverseOps.push(inverseRotateCCW);
        if (opName === 'Rotator 180') inverseOps.push(inverseRotate180);
        if (opName === 'Stacker') inverseOps.push(inverseUnstack);
        if (opName === 'Cutter') inverseOps.push(inverseUncut);
        if (opName === 'Pin Pusher') inverseOps.push(inverseUnpin);
        // Half Destroyer, Trash, Belt Split, Swapper, Crystal Generator: not invertible or complex
    }

    if (inverseOps.length === 0) return reachable;

    for (let depth = 1; depth <= maxDepth; depth++) {
        if (shouldCancel()) break;
        const nextFrontier = [];
        for (const code of frontier) {
            const shape = getCachedShape(code);
            for (const invOp of inverseOps) {
                const predecessorCodes = invOp(shape, config);
                for (const predCode of predecessorCodes) {
                    if (!predCode || reachable.has(predCode)) continue;
                    // Validate the predecessor code
                    try {
                        getCachedShape(predCode);
                    } catch {
                        continue;
                    }
                    reachable.set(predCode, depth);
                    nextFrontier.push(predCode);
                }
            }
        }
        frontier = nextFrontier;
        if (frontier.length === 0) break;
    }
    return reachable;
}

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
    onProgress = () => {}
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

    // Function to turn a state's shapes into a string for visited check
    function getStateKey(availableIds) {
        const countMap = {};
        for (const id of availableIds) {
            const code = getCanonicalCode(shapes.get(id));
            countMap[code] = (countMap[code] || 0) + 1;
        }
        const entries = Object.entries(countMap).sort();
        return JSON.stringify(entries);
    }

    // Goal check helper
    function isGoal(availableIds) {
        const shapeCodes = Array.from(availableIds).map(id => shapes.get(id));
        const hasTarget = shapeCodes.some(code => acceptable.has(code));
        const allTarget = preventWaste ? shapeCodes.every(code => acceptable.has(code)) : true;
        return hasTarget && allTarget;
    }

    // Generate all successor states from a given state
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
                            const newIds = [];
                            for (const outputShape of outputs) {
                                if (!outputShape.isEmpty()) {
                                    const outCode = outputShape.toShapeCode();
                                    // Skip no-op: output same as input
                                    if (outCode === inputCode) continue;
                                    const newId = nextId++;
                                    shapes.set(newId, outCode);
                                    newIds.push(newId);
                                }
                            }
                            if (newIds.length > 0) {
                                const newAvailableIds = new Set(availableIds);
                                newAvailableIds.delete(id);
                                for (const newId of newIds) {
                                    newAvailableIds.add(newId);
                                }
                                yield {
                                    availableIds: newAvailableIds,
                                    step: { type: opName, inputIds: [id], outputIds: newIds, color }
                                };
                            }
                        }
                    } else {
                        const outputs = getCachedOpResult1(opName, fn, inputShape, config);
                        const newIds = [];
                        for (const outputShape of outputs) {
                            if (!outputShape.isEmpty()) {
                                const outCode = outputShape.toShapeCode();
                                // Skip no-op: output same as input
                                if (outCode === inputCode) continue;
                                const newId = nextId++;
                                shapes.set(newId, outCode);
                                newIds.push(newId);
                            }
                        }
                        if (newIds.length > 0) {
                            const newAvailableIds = new Set(availableIds);
                            newAvailableIds.delete(id);
                            for (const newId of newIds) {
                                newAvailableIds.add(newId);
                            }
                            yield {
                                availableIds: newAvailableIds,
                                step: { type: opName, inputIds: [id], outputIds: newIds, color: null }
                            };
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
                        const newIds = [];
                        let isNoOp = true;
                        for (const outputShape of outputs) {
                            if (!outputShape.isEmpty()) {
                                const outCode = outputShape.toShapeCode();
                                if (outCode !== inputCode1 && outCode !== inputCode2) isNoOp = false;
                                const newId = nextId++;
                                shapes.set(newId, outCode);
                                newIds.push(newId);
                            }
                        }
                        // Skip no-op: all outputs identical to inputs
                        if (isNoOp && newIds.length === 2) continue;
                        if (newIds.length > 0) {
                            const newAvailableIds = new Set(availableIds);
                            newAvailableIds.delete(id1);
                            newAvailableIds.delete(id2);
                            for (const newId of newIds) {
                                newAvailableIds.add(newId);
                            }
                            yield {
                                availableIds: newAvailableIds,
                                step: { type: opName, inputIds: [id1, id2], outputIds: newIds, color: null }
                            };
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

        for (const successor of generateSuccessors(availableIds)) {
            const newKey = getStateKey(successor.availableIds);
            const newG = g + 1;
            if (!costSoFar.has(newKey) || newG < costSoFar.get(newKey)) {
                costSoFar.set(newKey, newG);
                const h = getHeuristic(successor.availableIds);
                open.enqueue({availableIds: successor.availableIds, stateKey: newKey}, newG + h);
                cameFrom.set(newKey, {
                    parentKey: stateKey,
                    step: successor.step
                });
            }
        }

        if (statesExplored % 500 === 0 || performance.now() - lastUpdate > 200) {
            onProgress(`A* | g=${g} | Open:${open.size()} | Explored:${statesExplored} | Total visited:${costSoFar.size}`);
            lastUpdate = performance.now();
        }
    }

    return shouldCancel() ? null : {solutionPath: null, depth: null, statesExplored};

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

            const successor = next.value;
            const succKey = getStateKey(successor.availableIds);

            // Cycle detection: skip if this state key is already on the path
            if (frame.pathKeys.has(succKey)) continue;

            const newPathKeys = new Set(frame.pathKeys);
            newPathKeys.add(succKey);

            stack.push({
                availableIds: successor.availableIds,
                g: frame.g + 1,
                path: [...frame.path, successor.step],
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

        for (const successor of generateSuccessors(availableIds)) {
            const newKey = getStateKey(successor.availableIds);
            const newG = g + 1;
            if (!costSoFar.has(newKey) || newG < costSoFar.get(newKey)) {
                costSoFar.set(newKey, newG);
                const h = getHeuristicBidirectional(successor.availableIds);
                open.enqueue({availableIds: successor.availableIds, stateKey: newKey}, newG + h);
                cameFrom.set(newKey, {
                    parentKey: stateKey,
                    step: successor.step
                });
            }
        }

        if (statesExplored % 500 === 0 || performance.now() - lastUpdate > 200) {
            onProgress(`Bidirectional | g=${g} | Open:${open.size()} | Explored:${statesExplored} | Total visited:${costSoFar.size} | Backward map:${backwardMap.size}`);
            lastUpdate = performance.now();
        }
    }

    return shouldCancel() ? null : {solutionPath: null, depth: null, statesExplored};

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
            for (const successor of generateSuccessors(availableIds)) {
                if (shouldCancel()) break;
                const stateKey = getStateKey(successor.availableIds);
                if (!visited.has(stateKey)) {
                    visited.add(stateKey);
                    const newPath = [...path, successor.step];
                    const newScore = calculateStateScore(successor.availableIds);
                    nextDepthStates.push({ availableIds: successor.availableIds, path: newPath, depth: depth + 1, score: newScore });
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
    return shouldCancel() ? null : {solutionPath: null, depth: null, statesExplored: visited.size};
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
