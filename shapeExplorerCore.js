import { Shape, ShapeOperationConfig } from './shapeOperations.js';
import { operations } from './shapeSolverCore.js';

// Breadth-first space explorer for the visualization: starting from the given
// shapes, repeatedly applies every enabled operation up to `depthLimit`, building
// a graph of shape nodes / operation nodes / edges. Self-contained — it shares
// none of the solver's search state and only reuses the `operations` table.
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

    // Shape ids are monotonically increasing indices starting at 0, so the shape
    // at index `id` is shapesList[id] — O(1), no linear scan.
    function getShapeById(id) {
        return Shape.fromShapeCode(shapesList[id].code);
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

                        // Extra check for Stacker: compare outputs for both orders.
                        // Ops never mutate their inputs, so s1/s2 are reused safely.
                        if (isStacker && id1 !== id2) {
                            const outA = fn(s1, s2, config)
                                .map(o => o.toShapeCode()).filter(Boolean);
                            const outB = fn(s2, s1, config)
                                .map(o => o.toShapeCode()).filter(Boolean);

                            // If same outputs, only process one ordering (id1 < id2)
                            if (JSON.stringify(outA) === JSON.stringify(outB) && id1 > id2) {
                                continue;
                            }
                        }

                        const outputs = fn(s1, s2, config);
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
