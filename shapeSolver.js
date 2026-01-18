import {
    Shape, ShapeOperationConfig,
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

const operations = {
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

let cancelled = false;

self.onmessage = async function (e) {
    const { action, data } = e.data;

    if (action === 'solve') {
        const {
            targetShapeCode,
            startingShapeCodes,
            enabledOperations,
            maxLayers,
            maxStatesPerLevel,
            preventWaste,
            orientationSensitive,
            monolayerPainting,
            heuristicDivisor = 4,
            searchMethod = 'A*'
        } = data;

        cancelled = false;
        const result = await shapeSolver(
            targetShapeCode,
            startingShapeCodes,
            enabledOperations,
            maxLayers,
            maxStatesPerLevel,
            preventWaste,
            orientationSensitive,
            monolayerPainting,
            heuristicDivisor,
            searchMethod
        );
        self.postMessage({ type: 'result', result });
    } else if (action === 'explore') {
        cancelled = false;
        const { startingShapeCodes, enabledOperations, depthLimit, maxLayers } = data;
        try {
            const graph = await shapeExplorer(startingShapeCodes, enabledOperations, depthLimit || 999, maxLayers || 4);
            if (!cancelled) {
                self.postMessage({ type: 'result', result: graph });
            }
        } catch (err) {
            self.postMessage({ type: 'status', message: `Error: ${err.message}` });
        }
    } else if (action === 'cancel') {
        cancelled = true;
        self.postMessage({ type: 'status', message: 'Cancelled.' });
    }
};

async function shapeSolver(targetShapeCode, startingShapeCodes, enabledOperations, maxLayers, maxStatesPerLevel = Infinity, preventWaste, orientationSensitive, monolayerPainting, heuristicDivisor = 4, searchMethod = 'A*') {
    const target = Shape.fromShapeCode(targetShapeCode);
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

    function getHeuristic(availableIds) {
        if (availableIds.size === 0) return Infinity;

        let bestSim = 0;
        let maxL = 0;

        for (const id of availableIds) {
            const shapeCode = shapes.get(id);
            const shape = Shape.fromShapeCode(shapeCode);
            maxL = Math.max(maxL, shape.numLayers);

            let sim = _getSimilarity(shape, target);
            if (!orientationSensitive) {
                const rotCodes = _getAllRotations(shape, config);
                for (const rcode of rotCodes) {
                    sim = Math.max(sim, _getSimilarity(Shape.fromShapeCode(rcode), target));
                }
            }
            bestSim = Math.max(bestSim, sim);
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

    // Function to calculate similarity score for a state
    function calculateStateScore(availableIds) {
        const shapeCodes = Array.from(availableIds).map(id => shapes.get(id));
        const shapeObjects = shapeCodes.map(code => Shape.fromShapeCode(code));

        let totalSimilarity = 0;
        for (const shape of shapeObjects) {
            totalSimilarity += _getSimilarity(shape, target);
        }

        return shapeObjects.length > 0 ? totalSimilarity / shapeObjects.length : 0;
    }

    // Function to turn a state's shapes into a string for visited check
    function getStateKey(availableIds) {
        const countMap = {};
        for (const id of availableIds) {
            const code = shapes.get(id);
            countMap[code] = (countMap[code] || 0) + 1;
        }
        const entries = Object.entries(countMap).sort();
        return JSON.stringify(entries);
    }

    if (searchMethod === 'A*') {
    // A* setup
    const open = new PriorityQueue();
    const costSoFar = new Map();  // stateKey -> g
    const cameFrom = new Map();   // stateKey -> {parentKey, step}

    const initialKey = getStateKey(initialAvailableIds);
    costSoFar.set(initialKey, 0);
    open.enqueue({availableIds: new Set(initialAvailableIds), stateKey: initialKey}, 0 + getHeuristic(initialAvailableIds));

    let statesExplored = 0;

    while (open.size() > 0 && !cancelled) {
        const currentItem = open.dequeue();
        if (!currentItem) break;
        statesExplored++;

        const {availableIds, stateKey} = currentItem.val;
        const g = costSoFar.get(stateKey);

        // Goal check (same as before)
        const shapeCodes = Array.from(availableIds).map(id => shapes.get(id));
        const hasTarget = shapeCodes.some(code => acceptable.has(code));
        const allTarget = preventWaste ? shapeCodes.every(code => acceptable.has(code)) : true;
        if (hasTarget && allTarget) {
            // Reconstruct path backward
            const solutionPath = [];
            let curKey = stateKey;
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
            return {
                solutionPath,
                depth: g,
                statesExplored
            };
        }

        // Generate successors
        for (const opName of enabledOperations) {
            if (cancelled) break;
            const op = operations[opName];
            if (!op) continue;
            const { fn, inputCount, needsColor } = op;

            if (inputCount === 1) {
                for (const id of availableIds) {
                    if (cancelled) break;
                    const inputShape = Shape.fromShapeCode(shapes.get(id));
                    if (needsColor) {
                        if (monolayerPainting && opName === "Painter" && inputShape.layers.length !== 1) {
                            continue;
                        }
                        const colors = opName === "Painter" ? _getPaintColors(inputShape, target) : targetCrystalColors;
                        for (const color of colors) {
                            const outputs = fn(inputShape, color, config);
                            const newIds = [];
                            for (const outputShape of outputs) {
                                if (!outputShape.isEmpty()) {
                                    const newId = nextId++;
                                    shapes.set(newId, outputShape.toShapeCode());
                                    newIds.push(newId);
                                }
                            }
                            if (newIds.length > 0) {
                                const newAvailableIds = new Set(availableIds);
                                newAvailableIds.delete(id);
                                for (const newId of newIds) {
                                    newAvailableIds.add(newId);
                                }
                                const newKey = getStateKey(newAvailableIds);
                                const newG = g + 1;
                                if (!costSoFar.has(newKey) || newG < costSoFar.get(newKey)) {
                                    costSoFar.set(newKey, newG);
                                    const h = getHeuristic(newAvailableIds);
                                    open.enqueue({availableIds: newAvailableIds, stateKey: newKey}, newG + h);
                                    cameFrom.set(newKey, {
                                        parentKey: stateKey,
                                        step: {type: opName, inputIds: [id], outputIds: newIds, color}
                                    });
                                }
                            }
                        }
                    } else {
                        const outputs = fn(inputShape, config);
                        const newIds = [];
                        for (const outputShape of outputs) {
                            if (!outputShape.isEmpty()) {
                                const newId = nextId++;
                                shapes.set(newId, outputShape.toShapeCode());
                                newIds.push(newId);
                            }
                        }
                        if (newIds.length > 0) {
                            const newAvailableIds = new Set(availableIds);
                            newAvailableIds.delete(id);
                            for (const newId of newIds) {
                                newAvailableIds.add(newId);
                            }
                            const newKey = getStateKey(newAvailableIds);
                            const newG = g + 1;
                            if (!costSoFar.has(newKey) || newG < costSoFar.get(newKey)) {
                                costSoFar.set(newKey, newG);
                                const h = getHeuristic(newAvailableIds);
                                open.enqueue({availableIds: newAvailableIds, stateKey: newKey}, newG + h);
                                cameFrom.set(newKey, {
                                    parentKey: stateKey,
                                    step: {type: opName, inputIds: [id], outputIds: newIds, color: null}
                                });
                            }
                        }
                    }
                }
            } else if (inputCount === 2) {
                const ids = Array.from(availableIds);
                for (let i = 0; i < ids.length && !cancelled; i++) {
                    for (let j = 0; j < ids.length && !cancelled; j++) {
                        if (i === j) continue;
                        const id1 = ids[i];
                        const id2 = ids[j];
                        const inputShape1 = Shape.fromShapeCode(shapes.get(id1));
                        const inputShape2 = Shape.fromShapeCode(shapes.get(id2));
                        const outputs = fn(inputShape1, inputShape2, config);
                        const newIds = [];
                        for (const outputShape of outputs) {
                            if (!outputShape.isEmpty()) {
                                const newId = nextId++;
                                shapes.set(newId, outputShape.toShapeCode());
                                newIds.push(newId);
                            }
                        }
                        if (newIds.length > 0) {
                            const newAvailableIds = new Set(availableIds);
                            newAvailableIds.delete(id1);
                            newAvailableIds.delete(id2);
                            for (const newId of newIds) {
                                newAvailableIds.add(newId);
                            }
                            const newKey = getStateKey(newAvailableIds);
                            const newG = g + 1;
                            if (!costSoFar.has(newKey) || newG < costSoFar.get(newKey)) {
                                costSoFar.set(newKey, newG);
                                const h = getHeuristic(newAvailableIds);
                                open.enqueue({availableIds: newAvailableIds, stateKey: newKey}, newG + h);
                                cameFrom.set(newKey, {
                                    parentKey: stateKey,
                                    step: {type: opName, inputIds: [id1, id2], outputIds: newIds, color: null}
                                });
                            }
                        }
                    }
                }
            }
        }

        // Status update (every ~200ms or every N states)
        if (statesExplored % 500 === 0 || performance.now() - lastUpdate > 200) {
            self.postMessage({
                type: 'status',
                message: `A* | g=${g} | Open:${open.size()} | Explored:${statesExplored} | Total visited:${costSoFar.size}`
            });
            lastUpdate = performance.now();
        }
    }

    return cancelled ? null : {solutionPath: null, depth: null, statesExplored};
    } else {
    // BFS setup
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
    while (queue.length > 0 && !cancelled) {
        const currentDepthStates = [];
        while (queue.length > 0 && queue[0].depth === depth) {
            currentDepthStates.push(queue.shift());
        }
        const nextDepthStates = [];
        for (const current of currentDepthStates) {
            if (cancelled) break;
            const availableIds = current.availableIds;
            const path = current.path;
            // Check if goal is reached
            const shapeCodes = Array.from(availableIds).map(id => shapes.get(id));
            const hasTarget = shapeCodes.some(code => acceptable.has(code));
            const allTarget = preventWaste ? shapeCodes.every(code => acceptable.has(code)) : true;
            if (hasTarget && allTarget) {
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
            for (const opName of enabledOperations) {
                if (cancelled) break;
                const op = operations[opName];
                if (!op) continue;
                const { fn, inputCount, needsColor } = op;
                if (inputCount === 1) {
                    for (const id of availableIds) {
                        if (cancelled) break;
                        const inputShape = Shape.fromShapeCode(shapes.get(id));
                        if (needsColor) {
                            if (monolayerPainting && opName === "Painter" && inputShape.layers.length !== 1) {
                                continue;
                            }
                            const colors = opName === "Painter" ? _getPaintColors(inputShape, target) : targetCrystalColors;
                            for (const color of colors) {
                                const outputs = fn(inputShape, color, config);
                                const newIds = [];
                                for (const outputShape of outputs) {
                                    if (!outputShape.isEmpty()) {
                                        const newId = nextId++;
                                        shapes.set(newId, outputShape.toShapeCode());
                                        newIds.push(newId);
                                    }
                                }
                                if (newIds.length > 0) {
                                    const newAvailableIds = new Set(availableIds);
                                    newAvailableIds.delete(id);
                                    for (const newId of newIds) {
                                        newAvailableIds.add(newId);
                                    }
                                    const stateKey = getStateKey(newAvailableIds);
                                    if (!visited.has(stateKey)) {
                                        visited.add(stateKey);
                                        const newPath = [...path, { type: opName, inputIds: [id], color, outputIds: newIds }];
                                        const newScore = calculateStateScore(newAvailableIds);
                                        nextDepthStates.push({ availableIds: newAvailableIds, path: newPath, depth: depth + 1, score: newScore });
                                    }
                                }
                            }
                        } else {
                            const outputs = fn(inputShape, config);
                            const newIds = [];
                            for (const outputShape of outputs) {
                                if (!outputShape.isEmpty()) {
                                    const newId = nextId++;
                                    shapes.set(newId, outputShape.toShapeCode());
                                    newIds.push(newId);
                                }
                            }
                            if (newIds.length > 0) {
                                const newAvailableIds = new Set(availableIds);
                                newAvailableIds.delete(id);
                                for (const newId of newIds) {
                                    newAvailableIds.add(newId);
                                }
                                const stateKey = getStateKey(newAvailableIds);
                                if (!visited.has(stateKey)) {
                                    visited.add(stateKey);
                                    const newPath = [...path, { type: opName, inputIds: [id], outputIds: newIds }];
                                    const newScore = calculateStateScore(newAvailableIds);
                                    nextDepthStates.push({ availableIds: newAvailableIds, path: newPath, depth: depth + 1, score: newScore });
                                }
                            }
                        }
                    }
                } else if (inputCount === 2) {
                    const ids = Array.from(availableIds);
                    for (let i = 0; i < ids.length && !cancelled; i++) {
                        for (let j = 0; j < ids.length && !cancelled; j++) {
                            if (i === j) continue;
                            const id1 = ids[i];
                            const id2 = ids[j];
                            const inputShape1 = Shape.fromShapeCode(shapes.get(id1));
                            const inputShape2 = Shape.fromShapeCode(shapes.get(id2));
                            const outputs = fn(inputShape1, inputShape2, config);
                            const newIds = [];
                            for (const outputShape of outputs) {
                                if (!outputShape.isEmpty()) {
                                    const newId = nextId++;
                                    shapes.set(newId, outputShape.toShapeCode());
                                    newIds.push(newId);
                                }
                            }
                            if (newIds.length > 0) {
                                const newAvailableIds = new Set(availableIds);
                                newAvailableIds.delete(id1);
                                newAvailableIds.delete(id2);
                                for (const newId of newIds) {
                                    newAvailableIds.add(newId);
                                }
                                const stateKey = getStateKey(newAvailableIds);
                                if (!visited.has(stateKey)) {
                                    visited.add(stateKey);
                                    const newPath = [...path, { type: opName, inputIds: [id1, id2], outputIds: newIds }];
                                    const newScore = calculateStateScore(newAvailableIds);
                                    nextDepthStates.push({ availableIds: newAvailableIds, path: newPath, depth: depth + 1, score: newScore });
                                }
                            }
                        }
                    }
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
            self.postMessage({
                type: 'status',
                message: `BFS | Depth ${depth} → ${queue.length} States | ${visited.size} Total States${pruneInfo}`
            });
            lastUpdate = now;
        }
    }
    return cancelled ? null : {solutionPath: null, depth: null, statesExplored: visited.size};
    }
}

async function shapeExplorer(startingShapeCodes, enabledOperations, depthLimit, maxLayers) {
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
        if (cancelled) {
            return null;
        }

        const newlyDiscovered = new Set();
        const startIds = Array.from(availableIds); // All shapes found so far
        const primaryIds = Array.from(frontier); // Shapes from previous depth

        if (primaryIds.length === 0) break;

        for (const opName of enabledOperations) {
            if (cancelled) {
                return null;
            }

            const op = operations[opName];
            if (!op) continue;

            const { fn, inputCount, needsColor } = op;

            if (inputCount === 1) {
                for (const id of primaryIds) {
                    if (cancelled) break;
                    
                    const inputShape = getShapeById(id);
                    if (inputShape.isEmpty()) continue;
                    const colors = needsColor ? ["r"] : [null];

                    for (const color of colors) {
                        if (cancelled) break;
                        
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
                    if (cancelled) break;
                    
                    const s1 = getShapeById(id1);
                    if (s1.isEmpty()) continue;
                    
                    for (const id2 of primaryIds) {
                        if (cancelled) break;

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

    if (!cancelled) {
        const shapesNodes = shapesList.map(s => ({ id: `shape-${s.id}`, code: s.code }));
        self.postMessage({ type: 'status', message: `Exploration complete. Shapes: ${shapesNodes.length}, Ops: ${opsList.length}` });
        return { shapes: shapesNodes, ops: opsList, edges };
    }
    
    return null;
}