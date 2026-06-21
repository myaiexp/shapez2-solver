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

    // Record one operation node and its edges: the op node, an edge from each input
    // shape, and an edge to each output shape (registering newly-discovered outputs
    // into availableIds and the per-depth frontier). Shared by the unary and binary
    // exploration paths, which previously each carried a verbatim copy of this tail.
    function recordOperation(opName, params, inputIds, outputCodes, newlyDiscovered) {
        const opId = `op-${nextOpId++}`;
        opsList.push({ id: opId, type: opName, params });
        for (const inId of inputIds) {
            edges.push({ source: `shape-${inId}`, target: opId });
        }
        for (const oc of outputCodes) {
            const { id: outId, added } = addShapeIfNew(oc);
            if (added) {
                availableIds.add(outId);
                newlyDiscovered.add(outId);
            }
            edges.push({ source: opId, target: `shape-${outId}` });
        }
    }

    // Apply a 1-input operation to every shape in the frontier.
    function exploreUnaryOp(op, opName, primaryIds, newlyDiscovered) {
        const { fn, needsColor } = op;
        for (const id of primaryIds) {
            if (shouldCancel()) return;

            const inputShape = getShapeById(id);
            if (inputShape.isEmpty()) continue;
            const colors = needsColor ? ["r"] : [null];

            for (const color of colors) {
                if (shouldCancel()) return;

                const outputs = needsColor ? fn(inputShape, color, config) : fn(inputShape, config);
                const outputCodes = outputs.map(o => o.toShapeCode()).filter(Boolean);

                // Skip no-ops: output identical to the input shape.
                if (outputCodes.some(oc => oc === shapesList[id].code)) continue;

                recordOperation(opName, color ? { color } : {}, [id], outputCodes, newlyDiscovered);
            }
        }
    }

    // Apply a 2-input operation to every ordered pair (frontier × all-so-far).
    function exploreBinaryOp(op, opName, startIds, primaryIds, newlyDiscovered) {
        const { fn } = op;
        const isStacker = opName === "Stacker";

        for (const id1 of startIds) {
            if (shouldCancel()) return;

            const shape1 = getShapeById(id1);
            if (shape1.isEmpty()) continue;

            for (const id2 of primaryIds) {
                if (shouldCancel()) return;

                if (id1 === id2 && !isStacker) continue;
                if (id1 > id2 && !isStacker) continue;

                const shape2 = getShapeById(id2);
                if (shape2.isEmpty()) continue;

                // Stacker is order-sensitive, so both orderings are explored — except
                // when they yield identical outputs, in which case keep only id1 < id2.
                // Ops never mutate their inputs, so shape1/shape2 are reused safely.
                if (isStacker && id1 !== id2) {
                    const outA = fn(shape1, shape2, config)
                        .map(o => o.toShapeCode()).filter(Boolean);
                    const outB = fn(shape2, shape1, config)
                        .map(o => o.toShapeCode()).filter(Boolean);
                    if (JSON.stringify(outA) === JSON.stringify(outB) && id1 > id2) {
                        continue;
                    }
                }

                const outputs = fn(shape1, shape2, config);
                const outputCodes = outputs.map(o => o.toShapeCode()).filter(Boolean);

                const code1 = shapesList[id1].code;
                const code2 = shapesList[id2].code;
                // Skip no-ops: every output is just one of the two inputs.
                if (outputCodes.some(oc => oc === code1 || oc === code2)) continue;

                recordOperation(opName, {}, [id1, id2], outputCodes, newlyDiscovered);
            }
        }
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
        const primaryIds = Array.from(frontier);   // Shapes from the previous depth

        if (primaryIds.length === 0) break;

        for (const opName of enabledOperations) {
            if (shouldCancel()) {
                return null;
            }

            const op = operations[opName];
            if (!op) continue;

            if (op.inputCount === 1) {
                exploreUnaryOp(op, opName, primaryIds, newlyDiscovered);
            } else if (op.inputCount === 2) {
                exploreBinaryOp(op, opName, startIds, primaryIds, newlyDiscovered);
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
